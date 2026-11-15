import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { prepareCatalog } from "../index";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro gera vetor de verdade, sem rede
const base = defaultEmbedder!;

type VectorRow = { text: string; dims: number; vector: string };

async function stored(id: number): Promise<VectorRow | undefined> {
  const [row] = await sql`
    SELECT texto AS text, vector_dims(embedding) AS dims, embedding::text AS vector
    FROM livros_vetores WHERE livro_id = ${id}
  ` as VectorRow[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

function token(): string {
  return crypto.randomUUID().slice(0, 8);
}

test("UC24: a extensão vector é criada pela aplicação, de forma idempotente", async () => {
  await prepareCatalog();
  await prepareCatalog();
  const [row] = await sql`SELECT count(*)::int AS n FROM pg_extension WHERE extname = 'vector'` as { n: number }[];
  expect(row!.n).toBe(1);
});

test("UC24: a tabela tem chave estrangeira com CASCADE e índice HNSW cosseno", async () => {
  await syncBookIndex([], catalogIntegration, base);
  const [fk] = await sql`
    SELECT confdeltype AS action, confrelid::regclass::text AS target
    FROM pg_constraint WHERE conrelid = 'livros_vetores'::regclass AND contype = 'f'
  ` as { action: string; target: string }[];
  expect(fk).toEqual({ action: "c", target: "livros" });
  const indexes = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores'` as { indexdef: string }[];
  expect(indexes.some((i) => /USING hnsw \(embedding vector_cosine_ops\)/.test(i.indexdef))).toBe(true);
});

test("UC24: o KNN com <=> pode usar o índice HNSW", async () => {
  const vector = `[${Array.from(new Float32Array(base.dimensions).fill(1)).join(",")}]`;
  const plan = await sql.begin(async (tx) => {
    // com poucos livros o planejador prefere Seq Scan: desligado só nesta transação
    await tx`SET LOCAL enable_seqscan = off`;
    return await tx`EXPLAIN SELECT livro_id FROM livros_vetores ORDER BY embedding <=> ${vector}::vector LIMIT 10` as { "QUERY PLAN": string }[];
  }) as { "QUERY PLAN": string }[];
  expect(plan.map((line) => line["QUERY PLAN"]).join("\n")).toContain("Index Scan using livros_vetores_embedding_idx");
});

test("UC24: livro cadastrado ganha vetor com título e autor, na dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${token()}`;
  const book = await createBook(title, author.id);
  const row = await stored(book.id);
  expect(row?.text).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(base.dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const before = await stored(book.id);
  const title = `Novo título ${token()}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const after = await stored(book.id);
  expect(after?.text).toBe(`${title} — ${author.nome}`);
  expect(after?.vector).not.toBe(before?.vector);
});

test("UC24: excluir o livro remove o vetor (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  expect(await stored(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await stored(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const name = `Autora ${token()}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await stored(book.id))?.text).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto no SQL, como no seed, ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const title = `Do seed ${token()}`;
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  expect(await stored(book!.id)).toBeUndefined();
  const { indexed } = await reconcileBookIndex(catalogIntegration, base);
  expect(indexed).toBeGreaterThanOrEqual(1);
  expect((await stored(book!.id))?.text).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
});

test("UC24: com o embedder fora do ar, a sincronização não lança e o livro continua lá", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  // o livro perde o vetor: há o que reindexar, mas o Gemini caiu
  await sql`DELETE FROM livros_vetores WHERE livro_id = ${book.id}`;
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([book.id], catalogIntegration, down)).toEqual({ indexed: 0 });
  expect(await reconcileBookIndex(catalogIntegration, down)).toEqual({ indexed: 0 });
  expect((await api("GET", `/livros/${book.id}`)).status).toBe(200);
  expect(await stored(book.id)).toBeUndefined();
  // o Gemini voltou: a próxima reconciliação dá o vetor ao livro
  await reconcileBookIndex(catalogIntegration, base);
  expect(await stored(book.id)).toBeDefined();
});

test("UC24: um embedder de outra dimensão refaz a tabela e reindexa", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const other = createHashEmbedder(512);
  const columnType = async () => {
    const [row] = await sql`
      SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
      WHERE attrelid = 'livros_vetores'::regclass AND attname = 'embedding'
    ` as { type: string }[];
    return row!.type;
  };
  try {
    await reconcileBookIndex(catalogIntegration, other);
    expect(await columnType()).toBe("vector(512)");
    expect((await stored(book.id))?.dims).toBe(512);
  } finally {
    // os outros testes dividem o banco: devolve a tabela ao embedder padrão
    await reconcileBookIndex(catalogIntegration, base);
  }
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  expect((await stored(book.id))?.dims).toBe(base.dimensions);
});
