import { afterAll, expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, settleBookIndex, syncBookIndex } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro indexa de verdade, sem rede
const base = createHashEmbedder();

type VectorRow = { text: string; dims: number; vector: string };

async function vectorOf(id: number): Promise<VectorRow | undefined> {
  const [row] = await sql`SELECT texto AS text, vector_dims(embedding) AS dims, embedding::text AS vector FROM livros_vetores WHERE livro_id = ${id}` as VectorRow[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

/** Como faz o seed: escreve direto em `livros`, sem passar pela API e sem vetor. */
async function insertBookBySql(title: string, authorId: number): Promise<number> {
  const [row] = await sql`INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao) VALUES (${testIsbn()}, ${title}, ${authorId}, '2026-01-01') RETURNING id` as { id: number }[];
  return row!.id;
}

const unique = () => `Livro ${crypto.randomUUID().slice(0, 8)}`;

// os testes compartilham o banco: o que trocar de embedder devolve a tabela de 1024 dimensões
afterAll(async () => {
  await reconcileBookIndex(catalogIntegration, base);
  await settleBookIndex();
});

test("UC24: livro cadastrado ganha uma linha com \"Título — Autor\" e vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = unique();
  const book = await createBook(title, author.id);
  const row = await vectorOf(book.id);
  expect(row?.text).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(base.dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(unique(), author.id);
  const before = await vectorOf(book.id);
  const title = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const after = await vectorOf(book.id);
  expect(after?.text).toBe(`${title} — ${author.nome}`);
  expect(after?.vector).not.toBe(before?.vector);
});

test("UC24: excluir o livro remove a linha (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(unique(), author.id);
  expect(await vectorOf(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await vectorOf(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(unique(), author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await vectorOf(book.id))?.text).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL ganha vetor depois da reconciliação", async () => {
  const author = await testAuthor();
  const id = await insertBookBySql(unique(), author.id);
  expect(await vectorOf(id)).toBeUndefined();
  await reconcileBookIndex(catalogIntegration, base);
  expect((await vectorOf(id))?.dims).toBe(base.dimensions);
});

test("UC24: texto desatualizado é refeito na reconciliação", async () => {
  const author = await testAuthor();
  const book = await createBook(unique(), author.id);
  // o autor foi renomeado enquanto o Gemini estava fora do ar: o texto guardado ficou para trás
  await sql`UPDATE autores SET nome = ${`Renomeada ${crypto.randomUUID().slice(0, 8)}`} WHERE id = ${author.id}`;
  const [current] = await sql`SELECT nome FROM autores WHERE id = ${author.id}` as { nome: string }[];
  await reconcileBookIndex(catalogIntegration, base);
  expect((await vectorOf(book.id))?.text).toEndWith(`— ${current!.nome}`);
});

test("UC24: sincronizar de novo um livro com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(unique(), author.id);
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
});

test("UC24: livro sem vetor chama o embedder uma vez e fica em dia", async () => {
  const author = await testAuthor();
  const id = await insertBookBySql(unique(), author.id);
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([id], catalogIntegration, counter)).toEqual({ indexed: 1 });
  expect(await syncBookIndex([id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(1);
});

test("UC24: com um embedder que falha a sincronização não lança, e o livro continua cadastrado", async () => {
  const author = await testAuthor();
  const id = await insertBookBySql(unique(), author.id);
  // mesmo id e mesma dimensão: o ensure não acha que o modelo mudou e não recria a tabela
  const offline: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([id], catalogIntegration, offline)).toEqual({ indexed: 0 });
  const [book] = await sql`SELECT id FROM livros WHERE id = ${id}`;
  expect(book).toBeDefined();
  expect(await vectorOf(id)).toBeUndefined();
});

test("UC24: sem embedder nada é indexado e nada lança", async () => {
  const author = await testAuthor();
  const id = await insertBookBySql(unique(), author.id);
  expect(await syncBookIndex([id], catalogIntegration, null)).toEqual({ indexed: 0 });
  expect(await reconcileBookIndex(catalogIntegration, null)).toEqual({ indexed: 0 });
});

test("UC24: um embedder de outra dimensão refaz a tabela e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(unique(), author.id);
  const small = createHashEmbedder(512);
  try {
    await syncBookIndex([book.id], catalogIntegration, small);
    await settleBookIndex();
    const [column] = await sql`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'` as { type: string }[];
    expect(column!.type).toBe("vector(512)");
    expect((await vectorOf(book.id))?.dims).toBe(512);
    const [others] = await sql`SELECT count(*)::int AS total FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id WHERE v.livro_id IS NULL` as { total: number }[];
    expect(others!.total).toBe(0);
  } finally {
    // devolve o banco ao estado que os outros testes esperam, e espera terminar
    await reconcileBookIndex(catalogIntegration, base);
    await settleBookIndex();
  }
  expect((await vectorOf(book.id))?.dims).toBe(base.dimensions);
});

test("UC24: o mesmo número de dimensões com outro modelo também refaz a tabela", async () => {
  const author = await testAuthor();
  const book = await createBook(unique(), author.id);
  const other: Embedder = { ...base, id: "outro-modelo-1024" };
  try {
    await syncBookIndex([book.id], catalogIntegration, other);
    await settleBookIndex();
    const [row] = await sql`SELECT modelo FROM livros_vetores WHERE livro_id = ${book.id}` as { modelo: string }[];
    expect(row!.modelo).toBe("outro-modelo-1024");
  } finally {
    await reconcileBookIndex(catalogIntegration, base);
    await settleBookIndex();
  }
  const [row] = await sql`SELECT modelo FROM livros_vetores WHERE livro_id = ${book.id}` as { modelo: string }[];
  expect(row!.modelo).toBe(base.id);
});

test("UC24: a tabela tem chave estrangeira com CASCADE e índice HNSW de distância cosseno", async () => {
  const [fk] = await sql`SELECT confdeltype::text AS action, confrelid::regclass::text AS target FROM pg_constraint WHERE conrelid = to_regclass('livros_vetores') AND contype = 'f'` as { action: string; target: string }[];
  expect(fk).toEqual({ action: "c", target: "livros" });
  const [index] = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexname = 'livros_vetores_embedding_idx'` as { indexdef: string }[];
  expect(index!.indexdef).toContain("USING hnsw");
  expect(index!.indexdef).toContain("vector_cosine_ops");
});

test("UC24: a consulta de vizinhos usa o índice HNSW (<=> com ORDER BY ... LIMIT)", async () => {
  const query = `[${Array.from({ length: base.dimensions }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
  const plan = await sql.begin(async (tx) => {
    // com poucos livros o planejador prefere ler a tabela inteira; isto só vale nesta transação
    await tx`SET LOCAL enable_seqscan = off`;
    return await tx.unsafe(`EXPLAIN SELECT livro_id FROM livros_vetores ORDER BY embedding <=> '${query}'::vector LIMIT 5`) as Record<string, string>[];
  });
  expect(plan.map((line) => Object.values(line)[0]).join("\n")).toContain("Index Scan using livros_vetores_embedding_idx");
});

test("UC24: a extensão vector existe e criá-la de novo é idempotente", async () => {
  const { prepareVectorExtension } = await import("./bookVectors");
  await prepareVectorExtension();
  await prepareVectorExtension();
  const [extension] = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'` as { extname: string }[];
  expect(extension!.extname).toBe("vector");
});

test("UC24: indexação e busca semântica não importam o Redis", async () => {
  const files = [
    "infrastructure/bookVectors.ts",
    "features/semantic-search-books/searchBooksSemantically.ts",
    "features/create-book/createBook.ts",
    "features/update-book/updateBook.ts",
    "features/delete-book/deleteBook.ts",
  ];
  for (const file of files) {
    const code = await Bun.file(new URL(`../${file}`, import.meta.url)).text();
    expect(code, file).not.toMatch(/infrastructure\/redis/);
  }
});
