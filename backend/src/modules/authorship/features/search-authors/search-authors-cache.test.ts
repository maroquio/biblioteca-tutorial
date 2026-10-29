import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn, testName } from "#tests/api";
import { createRedis } from "../../../../infrastructure/redis";
import { authorshipIntegration } from "../../../../integration/authorshipIntegration";
import { invalidateAuthorSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchAuthorsCached } from "./searchAuthorsCached";

async function search(q: string) {
  const response = await api("GET", `/autores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), authors: await response.json() as { id: number; nome: string }[] };
}

test("UC06: a segunda busca vem do cache", async () => {
  const author = await testAuthor();
  const first = await search(author.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(author.nome);
  expect(second.cache).toBe("HIT");
  expect(second.authors).toEqual(first.authors);
});

test("UC06: cadastrar, editar e excluir autor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const author = await testAuthor();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.authors.some((a) => a.id === author.id)).toBe(true);

  const renamed = testName("Autor");
  await search(renamed);
  expect((await api("PUT", `/autores/${author.id}`, { nome: renamed, tipo: "literatura" })).status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.authors.map((a) => a.id)).toEqual([author.id]);

  expect((await api("DELETE", `/autores/${author.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.authors).toEqual([]);
});

test("UC06: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.authors).toBeNull();
  // uma escrita termina entre a leitura no Postgres e a gravação no cache
  await invalidateAuthorSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", type: "literatura", bookCount: 0 }]);
  expect((await readCachedSearch(term))!.authors).toBeNull();
});

test("UC06: sem Redis a busca responde do Postgres", async () => {
  const author = await testAuthor();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchAuthorsCached(author.nome, authorshipIntegration, dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.authors.map((a) => a.id)).toEqual([author.id]);
  await invalidateAuthorSearch(dead);
});

test("UC06: cadastrar e excluir livro atualiza livrosNoAcervo no cache", async () => {
  const author = await testAuthor();
  await search(author.nome);
  const warm = await search(author.nome);
  expect(warm.cache).toBe("HIT");
  expect(warm.authors).toEqual([expect.objectContaining({ id: author.id, livrosNoAcervo: 0 })]);

  const book = await (await api("POST", "/livros", { isbn: testIsbn(), titulo: testName("Livro"), autorId: author.id })).json();
  const afterCreate = await search(author.nome);
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.authors).toEqual([expect.objectContaining({ livrosNoAcervo: 1 })]);

  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  const afterDelete = await search(author.nome);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.authors).toEqual([expect.objectContaining({ livrosNoAcervo: 0 })]);
});