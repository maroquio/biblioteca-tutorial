import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro grava o vetor de verdade, sem rede
type VectorRow = { texto: string; dims: number; embedding: string };

async function storedVector(id: number): Promise<VectorRow | undefined> {
  const [row] = await sql`
    SELECT texto, vector_dims(embedding) AS dims, embedding::text AS embedding
    FROM livros_vetores WHERE livro_id = ${id}
  ` as VectorRow[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

function uniqueTitle(prefix = "Livro"): string {
  return `${prefix} ${crypto.randomUUID().slice(0, 8)}`;
}

test("UC24: livro cadastrado ganha vetor com título, autor e a dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = uniqueTitle();
  const book = await createBook(title, author.id);
  const row = await storedVector(book.id);
  expect(row?.texto).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(createHashEmbedder().dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(uniqueTitle(), author.id);
  const before = await storedVector(book.id);
  const title = uniqueTitle("Novo título");
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const after = await storedVector(book.id);
  expect(after?.texto).toBe(`${title} — ${author.nome}`);
  expect(after?.embedding).not.toBe(before?.embedding);
});

test("UC24: excluir o livro remove o vetor (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(uniqueTitle(), author.id);
  expect(await storedVector(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await storedVector(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(uniqueTitle(), author.id);
  const name = uniqueTitle("Autora");
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await storedVector(book.id))?.texto).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL, como no seed, ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const title = uniqueTitle();
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-01-01')
    RETURNING id
  ` as { id: number }[];
  expect(await storedVector(book!.id)).toBeUndefined();
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  expect(indexed).toBeGreaterThanOrEqual(1);
  expect((await storedVector(book!.id))?.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(uniqueTitle(), author.id);
  // mesmo id e mesma dimensão do embedder padrão: a tabela não é recriada
  const base = createHashEmbedder();
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);
});

test("UC24: embedder fora do ar não lança e a escrita do livro continua", async () => {
  const author = await testAuthor();
  const book = await createBook(uniqueTitle(), author.id);
  const base = createHashEmbedder();
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  const title = uniqueTitle("Novo título");
  await sql`UPDATE livros SET titulo = ${title} WHERE id = ${book.id}`;
  expect(await syncBookIndex([book.id], catalogIntegration, down)).toEqual({ indexed: 0, removed: 0 });
  // o livro continua no Postgres, com o vetor antigo até a próxima reconciliação
  const [row] = await sql`SELECT titulo FROM livros WHERE id = ${book.id}` as { titulo: string }[];
  expect(row?.titulo).toBe(title);
  expect((await storedVector(book.id))?.texto).not.toStartWith(title);
  await syncBookIndex([book.id], catalogIntegration);
  expect((await storedVector(book.id))?.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: trocar o embedder refaz a tabela com a dimensão nova e reindexa", async () => {
  const author = await testAuthor();
  const book = await createBook(uniqueTitle(), author.id);
  const other = createHashEmbedder(512);
  try {
    await reconcileBookIndex(catalogIntegration, other);
    const [column] = await sql`
      SELECT format_type(atttypid, atttypmod) AS type
      FROM pg_attribute WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
    ` as { type: string }[];
    expect(column?.type).toBe("vector(512)");
    expect((await storedVector(book.id))?.dims).toBe(512);
  } finally {
    // o banco de testes é compartilhado: devolve a tabela ao embedder padrão antes do próximo teste
    await reconcileBookIndex(catalogIntegration);
  }
  expect((await storedVector(book.id))?.dims).toBe(createHashEmbedder().dimensions);
});

test("UC24: o índice é HNSW com distância cosseno e a busca usa o índice", async () => {
  const [index] = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexdef ILIKE '%hnsw%'` as { indexdef: string }[];
  expect(index?.indexdef).toContain("vector_cosine_ops");
  const plan = await sql.begin(async (tx) => {
    await tx`SET LOCAL enable_seqscan = off`;
    const vector = `[${Array.from({ length: createHashEmbedder().dimensions }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    return await tx.unsafe(`EXPLAIN SELECT livro_id FROM livros_vetores ORDER BY embedding <=> '${vector}'::vector LIMIT 10`) as { "QUERY PLAN": string }[];
  });
  expect(plan.map((line) => line["QUERY PLAN"]).join("\n")).toContain("Index Scan using livros_vetores_embedding_idx");
});
