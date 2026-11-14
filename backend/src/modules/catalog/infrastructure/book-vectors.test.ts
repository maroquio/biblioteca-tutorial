import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex } from "../index";
import { ensureBookIndex, syncBookIndex } from "./bookVectors";

type VectorRow = { text: string; dimensions: number; embedding: string; model: string };

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

async function vectorRow(bookId: number): Promise<VectorRow | undefined> {
  const [row] = await sql`
    SELECT texto AS text, vector_dims(embedding) AS dimensions,
           embedding::text AS embedding, modelo AS model
    FROM livros_vetores WHERE livro_id = ${bookId}
  ` as VectorRow[];
  return row;
}

test("UC24 pgvector: cadastrar grava texto e vetor com a dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro vetorial ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const row = await vectorRow(book.id);
  expect(row?.text).toBe(`${title} — ${author.nome}`);
  expect(row?.dimensions).toBe(createHashEmbedder().dimensions);
});

test("UC24 pgvector: editar título atualiza texto e vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Antes ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const before = await vectorRow(book.id);
  const title = `Depois ${crypto.randomUUID().slice(0, 8)}`;

  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const after = await vectorRow(book.id);
  expect(after?.text).toBe(`${title} — ${author.nome}`);
  expect(after?.embedding).not.toBe(before?.embedding);
});

test("UC24 pgvector: excluir livro remove vetor por cascade", async () => {
  const author = await testAuthor();
  const book = await createBook(`Excluir ${crypto.randomUUID().slice(0, 8)}`, author.id);
  expect(await vectorRow(book.id)).toBeDefined();

  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await vectorRow(book.id)).toBeUndefined();
});

test("UC24 pgvector: renomear autor atualiza os vetores dos livros", async () => {
  const author = await testAuthor();
  const book = await createBook(`Autoria ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;

  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await vectorRow(book.id))?.text).toEndWith(`— ${name}`);
});

test("UC24 pgvector: reconciliação indexa livro inserido diretamente", async () => {
  const author = await testAuthor();
  const title = `Seed ${crypto.randomUUID().slice(0, 8)}`;
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-11-14')
    RETURNING id
  ` as { id: number }[];

  expect(await vectorRow(book!.id)).toBeUndefined();
  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThan(0);
  expect((await vectorRow(book!.id))?.text).toBe(`${title} — ${author.nome}`);
});

test("UC24 pgvector: texto inalterado não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Idempotente ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const base = createHashEmbedder();
  let calls = 0;
  const counting: Embedder = {
    ...base,
    embed: async (texts, purpose) => {
      calls++;
      return base.embed(texts, purpose);
    },
  };

  expect(await vectorRow(book.id)).toBeDefined();
  expect(await syncBookIndex([book.id], catalogIntegration, counting)).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);
});

test("UC24 pgvector: falha do embedder não lança nem desfaz o livro", async () => {
  const author = await testAuthor();
  const book = await createBook(`Sem modelo ${crypto.randomUUID().slice(0, 8)}`, author.id);
  await sql`DELETE FROM livros_vetores WHERE livro_id = ${book.id}`;
  const base = createHashEmbedder();
  const unavailable: Embedder = {
    ...base,
    embed: async () => { throw new Error("fora do ar"); },
  };

  expect(await syncBookIndex([book.id], catalogIntegration, unavailable)).toEqual({ indexed: 0, removed: 0 });
  expect((await sql`SELECT id FROM livros WHERE id = ${book.id}`).length).toBe(1);
  expect(await vectorRow(book.id)).toBeUndefined();
});

test("UC24 pgvector: mudar modelo ou dimensão recria e repovoa a tabela", async () => {
  const standard = createHashEmbedder();
  const author = await testAuthor();
  const book = await createBook(`Dimensão ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const alternative = createHashEmbedder(16);
  try {
    expect((await reconcileBookIndex(catalogIntegration, alternative)).indexed).toBeGreaterThan(0);
    expect((await vectorRow(book.id))?.dimensions).toBe(16);
    expect((await vectorRow(book.id))?.model).toBe(alternative.id);
  } finally {
    await reconcileBookIndex(catalogIntegration, standard);
  }
  expect((await vectorRow(book.id))?.dimensions).toBe(standard.dimensions);
});

test("UC24 pgvector: esquema tem cascade e HNSW por distância cosseno", async () => {
  const [constraint] = await sql`
    SELECT confdeltype AS delete_action
    FROM pg_constraint
    WHERE conrelid = 'livros_vetores'::regclass AND contype = 'f'
  ` as { delete_action: string }[];
  const [index] = await sql`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'livros_vetores' AND indexdef ILIKE '%USING hnsw%'
  ` as { indexdef: string }[];

  expect(constraint?.delete_action).toBe("c");
  expect(index?.indexdef).toContain("vector_cosine_ops");
});

test("UC24 pgvector: recusa dimensão inválida antes de montar o DDL", async () => {
  await expect(ensureBookIndex({ ...createHashEmbedder(), dimensions: 0 })).rejects.toThrow(
    "Dimensão inválida para pgvector: 0",
  );
});
