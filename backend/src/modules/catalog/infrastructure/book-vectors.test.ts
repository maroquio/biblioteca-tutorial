import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro vetoriza de verdade, sem rede
const base = createHashEmbedder();

type VectorRow = { text: string; model: string; dimensions: number; vector: string };

async function vectorRow(id: number): Promise<VectorRow | undefined> {
  const [row] = await sql`
    SELECT texto AS text, modelo AS model, vector_dims(embedding) AS dimensions, embedding::text AS vector
    FROM livros_vetores WHERE livro_id = ${id}
  ` as VectorRow[];
  return row;
}

async function columnType(): Promise<string | undefined> {
  const [column] = await sql`
    SELECT format_type(atttypid, atttypmod) AS type
    FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
  ` as { type: string }[];
  return column?.type;
}

function title(): string {
  return `Livro ${crypto.randomUUID().slice(0, 8)}`;
}

async function createBook(bookTitle: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: bookTitle, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

test("UC24: livro cadastrado ganha vetor com título e autor, na dimensão do embedder", async () => {
  const author = await testAuthor();
  const bookTitle = title();
  const book = await createBook(bookTitle, author.id);
  expect(await vectorRow(book.id)).toMatchObject({ text: `${bookTitle} — ${author.nome}`, model: base.id, dimensions: base.dimensions });
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const before = await vectorRow(book.id);
  const newTitle = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: newTitle, autorId: author.id })).status).toBe(200);
  const after = await vectorRow(book.id);
  expect(after!.text).toBe(`${newTitle} — ${author.nome}`);
  expect(after!.vector).not.toBe(before!.vector);
});

test("UC24: excluir o livro remove o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await vectorRow(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await vectorRow(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const bookTitle = title();
  const book = await createBook(bookTitle, author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await vectorRow(book.id))!.text).toBe(`${bookTitle} — ${name}`);
});

test("UC24: livro inserido direto com SQL ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const bookTitle = title();
  // como o seed: escreve em livros sem passar pelo caso de uso
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${bookTitle}, ${author.id}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  expect(await vectorRow(book!.id)).toBeUndefined();
  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThanOrEqual(1);
  expect(await vectorRow(book!.id)).toMatchObject({ text: `${bookTitle} — ${author.nome}`, dimensions: base.dimensions });
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  // mesmo id e mesma dimensão do embedder padrão, mas conta quantas vezes foi chamado
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
});

test("UC24: com o embedder fora do ar a sincronização não lança e o cadastro não falha", async () => {
  const author = await testAuthor();
  const bookTitle = title();
  // mesmo id e mesma dimensão do embedder padrão, mas o embed sempre falha
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${bookTitle}, ${author.id}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  expect(await syncBookIndex([book!.id], catalogIntegration, down)).toEqual({ indexed: 0 });
  // o livro continua cadastrado, só que sem vetor, até a próxima reconciliação
  expect((await api("GET", `/livros/${book!.id}`)).status).toBe(200);
  expect(await vectorRow(book!.id)).toBeUndefined();
  await reconcileBookIndex(catalogIntegration);
  expect((await vectorRow(book!.id))!.text).toBe(`${bookTitle} — ${author.nome}`);
});

test("UC24: embedder de outra dimensão refaz a tabela e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  const other = createHashEmbedder(512);
  try {
    expect((await reconcileBookIndex(catalogIntegration, other)).indexed).toBeGreaterThanOrEqual(1);
    expect(await columnType()).toBe("vector(512)");
    expect(await vectorRow(book.id)).toMatchObject({ model: other.id, dimensions: 512 });
  } finally {
    // os testes dividem o banco: devolve a tabela ao embedder padrão antes de seguir
    await reconcileBookIndex(catalogIntegration);
  }
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  expect(await vectorRow(book.id)).toMatchObject({ model: base.id, dimensions: base.dimensions });
});

test("UC24: modelo diferente com a mesma dimensão também refaz a tabela", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const other: Embedder = { ...base, id: "outro-modelo-1024" };
  try {
    await reconcileBookIndex(catalogIntegration, other);
    expect((await vectorRow(book.id))!.model).toBe(other.id);
    const [row] = await sql`SELECT COUNT(*)::int AS total FROM livros_vetores WHERE modelo <> ${other.id}` as { total: number }[];
    expect(row!.total).toBe(0);
  } finally {
    await reconcileBookIndex(catalogIntegration);
  }
  expect((await vectorRow(book.id))!.model).toBe(base.id);
});
