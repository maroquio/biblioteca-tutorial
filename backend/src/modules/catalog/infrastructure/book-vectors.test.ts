import { expect, spyOn, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { embedder } from "../../../infrastructure/embedder";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { ensureBookIndex, reconcileBookIndex, syncBookIndex } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro grava um vetor de verdade, sem rede
const base = embedder!;

type StoredVector = { text: string; dims: number; vector: string };

/** A linha do livro na tabela de vetores, ou null. O vetor volta como texto para comparar. */
async function storedVector(id: number): Promise<StoredVector | null> {
  const [row] = await sql`SELECT texto AS text, vector_dims(embedding) AS dims, embedding::text AS vector FROM livros_vetores WHERE livro_id = ${id}` as StoredVector[];
  return row ?? null;
}

/** O tipo declarado da coluna, como o catálogo do Postgres o vê: "vector(1024)". */
async function columnType(): Promise<string | null> {
  const [row] = await sql`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'` as { type: string }[];
  return row?.type ?? null;
}

async function counts(): Promise<{ books: number; vectors: number }> {
  const [row] = await sql`SELECT (SELECT COUNT(*)::int FROM livros) AS books, (SELECT COUNT(*)::int FROM livros_vetores) AS vectors` as { books: number; vectors: number }[];
  return row!;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

/** Como o seed: escreve direto em livros, sem passar pelo caso de uso e, portanto, sem vetor. */
async function insertBookDirectly(title: string, authorId: number): Promise<number> {
  const [row] = await sql`INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao) VALUES (${testIsbn()}, ${title}, ${authorId}, '2026-11-11') RETURNING id` as { id: number }[];
  return row!.id;
}

function title(): string {
  return `Livro ${crypto.randomUUID().slice(0, 8)}`;
}

test("UC24: cadastrar grava o texto 'Título — Autor' e um vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const name = title();
  const book = await createBook(name, author.id);
  const row = await storedVector(book.id);
  expect(row?.text).toBe(`${name} — ${author.nome}`);
  expect(row?.dims).toBe(base.dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const before = await storedVector(book.id);
  const name = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: name, autorId: author.id })).status).toBe(200);
  const after = await storedVector(book.id);
  expect(after?.text).toBe(`${name} — ${author.nome}`);
  expect(after?.vector).not.toBe(before!.vector);
});

test("UC24: excluir o livro remove a linha do vetor (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await storedVector(book.id)).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await storedVector(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await storedVector(book.id))?.text).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL, como faz o seed, ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const name = title();
  const id = await insertBookDirectly(name, author.id);
  expect(await storedVector(id)).toBeNull();
  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThanOrEqual(1);
  expect((await storedVector(id))?.text).toBe(`${name} — ${author.nome}`);
});

test("UC24: sincronizar de novo um livro com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  // mesmo id e mesma dimensão do padrão (senão a tabela seria recriada), mas contando as chamadas
  let calls = 0;
  const counting: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counting)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
  // a prova de que o contador funciona: com o texto mudado, o embedder é chamado
  await sql`UPDATE livros SET titulo = ${title()} WHERE id = ${book.id}`;
  expect(await syncBookIndex([book.id], catalogIntegration, counting)).toEqual({ indexed: 1 });
  expect(calls).toBe(1);
});

test("UC24: com o embedder fora do ar, a sincronização não lança", async () => {
  const author = await testAuthor();
  const id = await insertBookDirectly(title(), author.id);
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([id], catalogIntegration, down)).toEqual({ indexed: 0 });
  expect(await storedVector(id)).toBeNull();
});

test("UC24: com o embedder fora do ar, o cadastro não falha e o vetor chega na reconciliação", async () => {
  const author = await testAuthor();
  // o mesmo objeto que o createBook usa por padrão, agora falhando como um Gemini fora do ar
  const failing = spyOn(base, "embed").mockImplementation(async () => { throw new Error("Gemini fora do ar"); });
  let book: { id: number };
  try {
    book = await createBook(title(), author.id);
  } finally {
    failing.mockRestore();
  }
  expect(await storedVector(book.id)).toBeNull();
  await reconcileBookIndex(catalogIntegration);
  expect(await storedVector(book.id)).not.toBeNull();
});

test("UC24: livro excluído durante o embedding não derruba o resto do lote", async () => {
  const author = await testAuthor();
  const gone = await insertBookDirectly(title(), author.id);
  const kept = await insertBookDirectly(title(), author.id);
  // o livro some enquanto o embedder calcula os vetores, como numa exclusão concorrente
  const racing: Embedder = {
    ...base,
    embed: async (texts, purpose) => {
      await sql`DELETE FROM livros WHERE id = ${gone}`;
      return base.embed(texts, purpose);
    },
  };
  expect(await syncBookIndex([gone, kept], catalogIntegration, racing)).toEqual({ indexed: 1 });
  expect(await storedVector(kept)).not.toBeNull();
});

test("UC24: um embedder de outra dimensão refaz a tabela, e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  await createBook(title(), author.id);
  try {
    await reconcileBookIndex(catalogIntegration, createHashEmbedder(512));
    expect(await columnType()).toBe("vector(512)");
    const { books, vectors } = await counts();
    expect(vectors).toBe(books);
  } finally {
    // o banco de testes é compartilhado: devolve a tabela ao embedder padrão, e espera terminar
    await reconcileBookIndex(catalogIntegration);
  }
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  const { books, vectors } = await counts();
  expect(vectors).toBe(books);
});

test("UC24: a tabela é do Acervo, com chave estrangeira em CASCADE e índice HNSW por cosseno", async () => {
  await ensureBookIndex(base);
  const [fk] = await sql`SELECT confrelid::regclass::text AS target, confdeltype::text AS "onDelete" FROM pg_constraint WHERE conrelid = to_regclass('livros_vetores') AND contype = 'f'` as { target: string; onDelete: string }[];
  expect(fk).toEqual({ target: "livros", onDelete: "c" });
  const indexes = await sql`SELECT indexdef AS definition FROM pg_indexes WHERE tablename = 'livros_vetores'` as { definition: string }[];
  expect(indexes.some((index) => index.definition.includes("USING hnsw (embedding vector_cosine_ops)"))).toBe(true);
});
