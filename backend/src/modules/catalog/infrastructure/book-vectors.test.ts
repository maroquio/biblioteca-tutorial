import { expect, spyOn, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { embedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import { reconcileBookIndex, syncBookIndex } from "./bookIndex";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro indexa de verdade, sem rede
async function indexedBook(id: number) {
  const [row] = await sql`
    SELECT texto, vector_dims(embedding) AS dimensions, embedding::text AS vector
    FROM acervo_livros_vetores WHERE livro_id = ${id}
  ` as { texto: string; dimensions: number; vector: string }[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

test("UC24: livro cadastrado é indexado com título e autor", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);
  expect(await indexedBook(book.id)).toMatchObject({ texto: `${title} — ${author.nome}`, dimensions: embedder!.dimensions });
});

test("UC24: editar o título reindexa", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const previous = await indexedBook(book.id);
  const title = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  expect((await indexedBook(book.id))?.texto).toBe(`${title} — ${author.nome}`);
  expect((await indexedBook(book.id))?.vector).not.toBe(previous?.vector);
});

test("UC24: excluir o livro remove do índice", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  expect(await indexedBook(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await indexedBook(book.id)).toBeUndefined();
});

test("UC24: renomear o autor reindexa os livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await indexedBook(book.id))?.texto).toEndWith(`— ${name}`);
});


test("UC24: reconcilia livros inseridos diretamente e vetores desatualizados", async () => {
  const author = await testAuthor();
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, 'Livro do seed', ${author.id}, '2026-01-01')
    RETURNING id
  ` as { id: number }[];
  try {
    await reconcileBookIndex(catalogIntegration);
    expect((await indexedBook(book!.id))?.texto).toBe(`Livro do seed — ${author.nome}`);
    await sql`UPDATE livros SET titulo = 'Novo título do seed' WHERE id = ${book!.id}`;
    await reconcileBookIndex(catalogIntegration);
    expect((await indexedBook(book!.id))?.texto).toBe(`Novo título do seed — ${author.nome}`);
  } finally {
    await sql`DELETE FROM livros WHERE id = ${book!.id}`;
  }
});

test("UC24: texto inalterado não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook("Mesmo título", author.id);
  const base = createHashEmbedder();
  const spy = spyOn(base, "embed");
  expect(await syncBookIndex([book.id], catalogIntegration, base)).toEqual({ indexed: 0 });
  expect(spy).not.toHaveBeenCalled();
});

test("UC24: falha no embedding não impede o cadastro e a reconciliação recupera o vetor", async () => {
  const author = await testAuthor();
  const failing = spyOn(embedder!, "embed").mockRejectedValue(new Error("Embedder fora do ar"));
  let book: Awaited<ReturnType<typeof createBook>>;
  try {
    book = await createBook("Livro durante a falha", author.id);
    expect(failing).toHaveBeenCalled();
    expect(await indexedBook(book.id)).toBeUndefined();
    expect(await syncBookIndex([book.id], catalogIntegration)).toEqual({ indexed: 0 });
  } finally {
    failing.mockRestore();
  }

  await reconcileBookIndex(catalogIntegration);
  expect(await indexedBook(book.id)).toBeDefined();
});

test("UC24: trocar modelo ou dimensão recria a tabela e reindexa os livros", async () => {
  const author = await testAuthor();
  const book = await createBook("Livro de referência", author.id);
  const base = createHashEmbedder();
  try {
    const newModel = { ...base, id: "outro-modelo" };
    expect((await reconcileBookIndex(catalogIntegration, newModel)).indexed).toBeGreaterThan(0);
    expect((await indexedBook(book.id))?.dimensions).toBe(base.dimensions);

    const smaller = createHashEmbedder(512);
    expect((await reconcileBookIndex(catalogIntegration, smaller)).indexed).toBeGreaterThan(0);
    expect((await indexedBook(book.id))?.dimensions).toBe(512);
  } finally {
    await reconcileBookIndex(catalogIntegration, base);
  }

  expect((await indexedBook(book.id))?.dimensions).toBe(base.dimensions);
});
