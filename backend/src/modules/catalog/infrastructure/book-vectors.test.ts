import { expect, spyOn, test } from "bun:test";
import { api, testAuthor, testIsbn, testName } from "#tests/api";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { ServiceUnavailable } from "../../../shared/errors";
import { searchBooksSemantically } from "../features/semantic-search-books/searchBooksSemantically";
import { ensureBookIndex, reconcileBookIndex, syncBookIndex } from "./bookIndex";

const base = createHashEmbedder();

async function createBook() {
  const author = await testAuthor();
  const title = testName("Livro");
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: author.id });
  expect(response.status).toBe(201);
  return { book: await response.json<{ id: number; isbn: string }>(), author, title };
}

async function vectorRow(id: number) {
  const [row] = await sql`
    SELECT texto, embedding::text AS vetor, vector_dims(embedding) AS dimensoes
    FROM livros_vetores WHERE livro_id = ${id}
  ` as { texto: string; vetor: string; dimensoes: number }[];
  return row;
}

test("UC24 pgvector: cadastro grava título, autor e dimensão; ensure é idempotente", async () => {
  const { book, author, title } = await createBook();
  const before = await vectorRow(book.id);
  expect(before).toMatchObject({ texto: `${title} — ${author.nome}`, dimensoes: base.dimensions });
  expect(await ensureBookIndex(base)).toBe(false);
  expect(await vectorRow(book.id)).toEqual(before);
  const indexes = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores'` as { indexdef: string }[];
  expect(indexes.some(({ indexdef }) => /USING hnsw.*vector_cosine_ops/i.test(indexdef))).toBe(true);
});

test("UC24 pgvector: editar título atualiza texto e vetor", async () => {
  const { book, author } = await createBook();
  const before = await vectorRow(book.id);
  const title = testName("Astronomia e planetas");
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  expect((await vectorRow(book.id))!.texto).toBe(`${title} — ${author.nome}`);
  expect((await vectorRow(book.id))!.vetor).not.toBe(before!.vetor);
});

test("UC24 pgvector: exclusão pela API e por SQL remove vetores por CASCADE", async () => {
  const first = await createBook();
  expect(await vectorRow(first.book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${first.book.id}`)).status).toBe(204);
  expect(await vectorRow(first.book.id)).toBeUndefined();
  const second = await createBook();
  expect(await vectorRow(second.book.id)).toBeDefined();
  await sql`DELETE FROM livros WHERE id = ${second.book.id}`;
  expect(await vectorRow(second.book.id)).toBeUndefined();
});

test("UC24 pgvector: renomear autor atualiza os livros dele", async () => {
  const { book, title, author } = await createBook();
  const name = testName("Autora");
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await vectorRow(book.id))!.texto).toBe(`${title} — ${name}`);
});

test("UC24 pgvector: reconciliação inclui livro SQL e corrige texto desatualizado", async () => {
  const author = await testAuthor();
  const title = testName("Seed");
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-11-27') RETURNING id
  ` as { id: number }[];
  expect(await vectorRow(book!.id)).toBeUndefined();
  await reconcileBookIndex(catalogIntegration);
  expect((await vectorRow(book!.id))!.texto).toBe(`${title} — ${author.nome}`);
  await sql`UPDATE livros SET titulo = ${title + " atualizado"} WHERE id = ${book!.id}`;
  await reconcileBookIndex(catalogIntegration);
  expect((await vectorRow(book!.id))!.texto).toBe(`${title} atualizado — ${author.nome}`);
});

test("UC24 pgvector: texto igual não chama embedder novamente", async () => {
  const { book } = await createBook();
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id, book.id], catalogIntegration, counter)).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);
});

test("UC24 pgvector: falha do provedor preserva cadastro e reconciliação recupera vetor", async () => {
  const author = await testAuthor();
  const failing = spyOn(defaultEmbedder!, "embed").mockRejectedValue(new Error("Gemini indisponível"));
  let id: number;
  try {
    const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: testName("Sem Gemini"), autorId: author.id });
    expect(response.status).toBe(201);
    id = (await response.json<{ id: number }>()).id;
    expect((await api("GET", `/livros/id/${id}`)).status).toBe(200);
    expect(await vectorRow(id)).toBeUndefined();
    expect(await syncBookIndex([id], catalogIntegration)).toEqual({ indexed: 0, removed: 0 });
    await expect(searchBooksSemantically("Livro", catalogIntegration)).rejects.toBeInstanceOf(ServiceUnavailable);
  } finally {
    failing.mockRestore();
  }
  await reconcileBookIndex(catalogIntegration);
  expect(await vectorRow(id!)).toBeDefined();
});

test("UC24 pgvector: dimensão inválida não apaga vetores existentes", async () => {
  const { book } = await createBook();
  const before = await vectorRow(book.id);
  for (const dimensions of [0, -1, 1.5, 2001, NaN]) {
    await expect(ensureBookIndex({ ...base, dimensions })).rejects.toThrow("Dimensão inválida");
  }
  expect(await vectorRow(book.id)).toEqual(before);
});

test("UC24 pgvector: trocar dimensão refaz tabela e reindexa todos os livros", async () => {
  const first = await createBook();
  const second = await createBook();
  try {
    await syncBookIndex([first.book.id], catalogIntegration, createHashEmbedder(512));
    expect((await vectorRow(first.book.id))!.dimensoes).toBe(512);
    expect((await vectorRow(second.book.id))!.dimensoes).toBe(512);
    const [column] = await sql`
      SELECT format_type(atttypid, atttypmod) AS tipo FROM pg_attribute
      WHERE attrelid = 'livros_vetores'::regclass AND attname = 'embedding'
    ` as { tipo: string }[];
    expect(column!.tipo).toBe("vector(512)");
  } finally {
    await reconcileBookIndex(catalogIntegration, base);
  }
  expect((await vectorRow(first.book.id))!.dimensoes).toBe(base.dimensions);
});

test("UC24 pgvector: modelo diferente da mesma dimensão também reindexa", async () => {
  const { book } = await createBook();
  let calls = 0;
  const other: Embedder = { ...base, id: "outro-modelo", embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  try {
    await reconcileBookIndex(catalogIntegration, other);
    expect(calls).toBeGreaterThan(0);
    expect(await vectorRow(book.id)).toBeDefined();
    expect(await ensureBookIndex(other)).toBe(false);
  } finally {
    await reconcileBookIndex(catalogIntegration, base);
  }
});

test("UC24 pgvector: consulta não mistura modelos trocados durante o embedding", async () => {
  await createBook();
  const switching: Embedder = { ...base, embed: async (texts, purpose) => {
    if (purpose === "query") await reconcileBookIndex(catalogIntegration, { ...base, id: "modelo-concorrente" });
    return base.embed(texts, purpose);
  } };
  try {
    await expect(searchBooksSemantically("Livro", catalogIntegration, { embedder: switching })).rejects.toBeInstanceOf(ServiceUnavailable);
  } finally {
    await reconcileBookIndex(catalogIntegration, base);
  }
});
