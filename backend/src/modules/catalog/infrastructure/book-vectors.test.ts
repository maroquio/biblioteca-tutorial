import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import {
  ensureBookIndex,
  reconcileBookIndex,
  syncBookIndex,
} from "./bookVectors";

const embedder = createHashEmbedder();

async function createBook(
  title: string,
  authorId: number,
): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", {
    isbn: testIsbn(),
    titulo: title,
    autorId: authorId,
  });

  expect(response.status).toBe(201);

  return response.json();
}

async function indexedBook(id: number) {
  const [row] = await sql`
    SELECT
      texto,
      vector_dims(embedding) AS dimensions,
      embedding::text AS vector
    FROM livros_vetores
    WHERE livro_id = ${id}
  ` as {
    texto: string;
    dimensions: number;
    vector: string;
  }[];

  return row;
}

test("UC24: book creation stores its text and embedding", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID()}`;
  const book = await createBook(title, author.id);

  const row = await indexedBook(book.id);

  expect(row).toBeDefined();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
  expect(row!.dimensions).toBe(embedder.dimensions);
});

test("UC24: updating a book title updates its text and embedding", async () => {
  const author = await testAuthor();
  const book = await createBook(
    `Livro ${crypto.randomUUID()}`,
    author.id,
  );

  const previous = await indexedBook(book.id);
  const title = `Novo título ${crypto.randomUUID()}`;

  const response = await api("PUT", `/livros/${book.id}`, {
    isbn: book.isbn,
    titulo: title,
    autorId: author.id,
  });

  expect(response.status).toBe(200);

  const updated = await indexedBook(book.id);

  expect(updated!.texto).toBe(`${title} — ${author.nome}`);
  expect(updated!.vector).not.toBe(previous!.vector);
});

test("UC24: deleting a book removes its vector through CASCADE", async () => {
  const author = await testAuthor();
  const book = await createBook(
    `Livro ${crypto.randomUUID()}`,
    author.id,
  );

  expect(await indexedBook(book.id)).toBeDefined();

  const response = await api("DELETE", `/livros/${book.id}`);

  expect(response.status).toBe(204);
  expect(await indexedBook(book.id)).toBeUndefined();
});

test("UC24: renaming an author updates the indexed text of their books", async () => {
  const author = await testAuthor();
  const book = await createBook(
    `Livro ${crypto.randomUUID()}`,
    author.id,
  );

  const name = `Autora ${crypto.randomUUID()}`;

  const response = await api("PUT", `/autores/${author.id}`, {
    nome: name,
    tipo: "literatura",
  });

  expect(response.status).toBe(200);

  const row = await indexedBook(book.id);

  expect(row!.texto).toEndWith(`— ${name}`);
});

test("UC24: reconciliation indexes books inserted directly into PostgreSQL", async () => {
  const author = await testAuthor();
  const title = `Livro seed ${crypto.randomUUID()}`;

  const [book] = await sql`
    INSERT INTO livros (
      isbn,
      titulo,
      autor_id,
      data_catalogacao
    )
    VALUES (
      ${testIsbn()},
      ${title},
      ${author.id},
      CURRENT_DATE::text
    )
    RETURNING id
  ` as { id: number }[];

  expect(await indexedBook(book!.id)).toBeUndefined();

  await reconcileBookIndex(catalogIntegration, embedder);

  const row = await indexedBook(book!.id);

  expect(row).toBeDefined();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: synchronizing unchanged text does not call the embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(
    `Livro ${crypto.randomUUID()}`,
    author.id,
  );

  let calls = 0;

  const counter: Embedder = {
    ...embedder,
    async embed(texts, purpose) {
      calls++;
      return embedder.embed(texts, purpose);
    },
  };

  await syncBookIndex([book.id], catalogIntegration, counter);

  expect(calls).toBe(0);
});

test("UC24: an embedding failure does not fail the book synchronization", async () => {
  const author = await testAuthor();
  const book = await createBook(
    `Livro ${crypto.randomUUID()}`,
    author.id,
  );

  const failing: Embedder = {
    ...embedder,
    async embed() {
      throw new Error("Simulated embedding failure");
    },
  };

  const result = await syncBookIndex(
    [book.id],
    catalogIntegration,
    failing,
  );

  expect(result).toEqual({
    indexed: 0,
    removed: 0,
  });

  // The book itself remains in PostgreSQL.
  const [storedBook] = await sql`
    SELECT id
    FROM livros
    WHERE id = ${book.id}
  ` as { id: number }[];

  expect(storedBook?.id).toBe(book.id);

  // Restore the normal test embedder and rebuild the vectors.
  await reconcileBookIndex(catalogIntegration, embedder);
});

test("UC24: changing embedding dimensions recreates and repopulates the table", async () => {
  const author = await testAuthor();
  const book = await createBook(
    `Livro ${crypto.randomUUID()}`,
    author.id,
  );

  const differentEmbedder = createHashEmbedder(512);

  try {
    const created = await ensureBookIndex(differentEmbedder);

    expect(created).toBe(true);

    await reconcileBookIndex(
      catalogIntegration,
      differentEmbedder,
    );

    const row = await indexedBook(book.id);

    expect(row).toBeDefined();
    expect(row!.dimensions).toBe(512);
  } finally {
    // Other tests use the default 1024-dimensional hash embedder.
    await reconcileBookIndex(catalogIntegration, embedder);
  }
});
