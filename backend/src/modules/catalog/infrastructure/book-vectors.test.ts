import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { ensureBookIndex, reconcileBookIndex, syncBookIndex } from "./bookVectors";
import { prepareCatalog } from "./schema";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro grava o vetor de verdade, sem rede
const base = createHashEmbedder();

type StoredVector = { text: string; dims: number; embedding: string };

async function storedVector(bookId: number): Promise<StoredVector | undefined> {
  const [row] = await sql`SELECT texto AS text, vector_dims(embedding) AS dims, embedding::text AS embedding FROM livros_vetores WHERE livro_id = ${bookId}` as StoredVector[];
  return row;
}

async function columnType(): Promise<string | undefined> {
  const [row] = await sql`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'` as { type: string }[];
  return row?.type;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

/** Como o seed: direto na tabela, sem passar pelo caso de uso e, portanto, sem vetor. */
async function insertBookDirectly(title: string, authorId: number): Promise<number> {
  const [row] = await sql`INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao) VALUES (${testIsbn()}, ${title}, ${authorId}, '2026-01-01') RETURNING id` as { id: number }[];
  return row!.id;
}

function title(): string {
  return `Livro ${crypto.randomUUID().slice(0, 8)}`;
}

test("pgvector: a extensão existe no banco e preparar de novo não falha", async () => {
  await prepareCatalog();
  const [row] = await sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'` as { extversion: string }[];
  expect(row?.extversion).toBeString();
});

test("UC24: os vetores saem junto com o livro (CASCADE) e têm índice HNSW cosseno", async () => {
  await ensureBookIndex(base);
  const [fk] = await sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = to_regclass('livros_vetores') AND contype = 'f'` as { def: string }[];
  expect(fk?.def).toBe("FOREIGN KEY (livro_id) REFERENCES livros(id) ON DELETE CASCADE");
  const [index] = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexdef LIKE '%USING hnsw%'` as { indexdef: string }[];
  expect(index?.indexdef).toContain("USING hnsw (embedding vector_cosine_ops)");
});

test("UC24: livro cadastrado ganha vetor com título e autor", async () => {
  const author = await testAuthor();
  const name = title();
  const book = await createBook(name, author.id);
  expect(await storedVector(book.id)).toMatchObject({ text: `${name} — ${author.nome}`, dims: base.dimensions });
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const before = await storedVector(book.id);
  const name = title();
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: name, autorId: author.id })).status).toBe(200);
  const after = await storedVector(book.id);
  expect(after?.text).toBe(`${name} — ${author.nome}`);
  expect(after?.embedding).not.toBe(before?.embedding);
});

test("UC24: excluir o livro remove o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await storedVector(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await storedVector(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await storedVector(book.id))?.text).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto no banco, como no seed, ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const id = await insertBookDirectly(title(), author.id);
  expect(await storedVector(id)).toBeUndefined();
  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThanOrEqual(1);
  expect((await storedVector(id))?.dims).toBe(base.dimensions);
});

test("UC24: texto igual não chama o embedder de novo", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  // mesmo id e mesma dimensão do embedder padrão: a tabela não é recriada
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
  // o contador funciona: com o texto mudado por fora, o embedder é chamado
  await sql`UPDATE livros SET titulo = ${title()} WHERE id = ${book.id}`;
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 1 });
  expect(calls).toBe(1);
});

test("UC24: embedder fora do ar não derruba a escrita do livro", async () => {
  const author = await testAuthor();
  const id = await insertBookDirectly(title(), author.id);
  const offline: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([id], catalogIntegration, offline)).toEqual({ indexed: 0 });
  // o livro continua cadastrado, só sem vetor até a próxima reconciliação
  expect(await sql`SELECT id FROM livros WHERE id = ${id}`).toHaveLength(1);
  expect(await storedVector(id)).toBeUndefined();
});

test("UC24: outro embedder refaz a tabela com a dimensão dele e reindexa os livros", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  try {
    await reconcileBookIndex(catalogIntegration, createHashEmbedder(512));
    expect(await columnType()).toBe("vector(512)");
    expect((await storedVector(book.id))?.dims).toBe(512);
    const missing = await sql`SELECT l.id FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id WHERE v.livro_id IS NULL`;
    expect(missing).toHaveLength(0);
  } finally {
    // o banco de testes é compartilhado: devolve a tabela de 1024 dimensões que os outros testes usam
    await reconcileBookIndex(catalogIntegration);
  }
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  expect((await storedVector(book.id))?.dims).toBe(base.dimensions);
});
