import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

const base = createHashEmbedder();

type VectorRow = { text: string; dims: number; embedding: string };

async function storedVector(id: number): Promise<VectorRow | null> {
  const [row] = await sql`
    SELECT texto AS text, vector_dims(embedding) AS dims, embedding::text AS embedding
    FROM livros_vetores WHERE livro_id = ${id}
  ` as VectorRow[];
  return row ?? null;
}

async function columnType(): Promise<string | null> {
  const [row] = await sql`
    SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
  ` as { type: string }[];
  return row?.type ?? null;
}

function token(): string {
  return crypto.randomUUID().slice(0, 8);
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

async function insertBookWithSql(title: string, authorId: number): Promise<number> {
  const [row] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${authorId}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  return row!.id;
}

test("UC24: cadastrar grava o texto 'Título — Autor' e um vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${token()}`;
  const book = await createBook(title, author.id);
  const row = await storedVector(book.id);
  expect(row?.text).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(base.dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const before = await storedVector(book.id);
  const title = `Novo título ${token()}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const after = await storedVector(book.id);
  expect(after?.text).toBe(`${title} — ${author.nome}`);
  expect(after?.embedding).not.toBe(before!.embedding);
});

test("UC24: excluir o livro remove a linha do vetor (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  expect(await storedVector(book.id)).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await storedVector(book.id)).toBeNull();
});

test("UC24: excluir direto com SQL também leva o vetor, sem violar a chave estrangeira", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  await sql`DELETE FROM livros WHERE id = ${book.id}`;
  expect(await storedVector(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const name = `Autora ${token()}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await storedVector(book.id))?.text).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const title = `Livro do seed ${token()}`;
  const id = await insertBookWithSql(title, author.id);
  expect(await storedVector(id)).toBeNull();
  const { indexed } = await reconcileBookIndex(catalogIntegration, base);
  expect(indexed).toBeGreaterThanOrEqual(1);
  const row = await storedVector(id);
  expect(row?.text).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(base.dimensions);
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };

  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);

  await sql`DELETE FROM livros_vetores WHERE livro_id = ${book.id}`;
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 1 });
  expect(calls).toBe(1);
});

test("UC24: com o embedder fora do ar a sincronização não lança e o livro continua cadastrado", async () => {
  const author = await testAuthor();
  const id = await insertBookWithSql(`Livro ${token()}`, author.id);
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };

  expect(await syncBookIndex([id], catalogIntegration, down)).toEqual({ indexed: 0 });
  expect(await reconcileBookIndex(catalogIntegration, down)).toEqual({ indexed: 0 });
  expect(await storedVector(id)).toBeNull();
  const [book] = await sql`SELECT id FROM livros WHERE id = ${id}`;
  expect(book).toBeDefined();

  await reconcileBookIndex(catalogIntegration, base);
  expect(await storedVector(id)).not.toBeNull();
});

test("UC24: sem embedder (sem chave do Gemini) a sincronização não faz nada e não lança", async () => {
  const author = await testAuthor();
  const id = await insertBookWithSql(`Livro ${token()}`, author.id);
  expect(await syncBookIndex([id], catalogIntegration, null)).toEqual({ indexed: 0 });
  expect(await storedVector(id)).toBeNull();
  await syncBookIndex([id], catalogIntegration, base);
});

test("UC24: um embedder de outra dimensão refaz a tabela e reindexa os livros", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const other = createHashEmbedder(512);
  try {
    await reconcileBookIndex(catalogIntegration, other);
    expect(await columnType()).toBe("vector(512)");
    expect((await storedVector(book.id))?.dims).toBe(512);
    const [counts] = await sql`
      SELECT (SELECT count(*) FROM livros)::int AS books, (SELECT count(*) FROM livros_vetores)::int AS vectors
    ` as { books: number; vectors: number }[];
    expect(counts!.vectors).toBe(counts!.books);
  } finally {
    await reconcileBookIndex(catalogIntegration, base);
  }
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  expect((await storedVector(book.id))?.dims).toBe(base.dimensions);
});

test("UC24: o índice é HNSW com distância cosseno", async () => {
  const [index] = await sql`
    SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexdef ILIKE '%hnsw%'
  ` as { indexdef: string }[];
  expect(index?.indexdef).toContain("vector_cosine_ops");
});
