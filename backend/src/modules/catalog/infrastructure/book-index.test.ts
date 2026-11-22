import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { createRedis, ready, redis } from "../../../infrastructure/redis";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import { bookIndexKey, syncBookIndex } from "./bookIndex";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro indexa de verdade, sem rede
async function indexedText(id: number): Promise<string | null> {
  return (await ready(redis!)).hget(bookIndexKey(id), "texto");
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
  expect(await indexedText(book.id)).toBe(`${title} — ${author.nome}`);
});

test("UC24: editar o título reindexa", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const title = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  expect(await indexedText(book.id)).toBe(`${title} — ${author.nome}`);
});

test("UC24: excluir o livro remove do índice", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  expect(await redis!.exists(bookIndexKey(book.id))).toBe(true);
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await redis!.exists(bookIndexKey(book.id))).toBe(false);
});

test("UC24: renomear o autor reindexa os livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect(await indexedText(book.id)).toEndWith(`— ${name}`);
});

test("UC24: sem Redis a escrita do livro não falha", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  expect(await syncBookIndex([book.id], catalogIntegration, createHashEmbedder(), dead)).toEqual({ indexed: 0, removed: 0 });
});

test("UC24: vetor com tamanho errado é refeito mesmo com o texto igual", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);
  // um vetor que o índice recusou (outra dimensão) e ficou para trás com o texto certo
  await redis!.send("HSET", [bookIndexKey(book.id), "embedding", "curto"]);
  const embedder = createHashEmbedder();
  expect(await syncBookIndex([book.id], catalogIntegration, embedder)).toEqual({ indexed: 1, removed: 0 });
  expect(await redis!.send("HSTRLEN", [bookIndexKey(book.id), "embedding"])).toBe(embedder.dimensions * 4);
});