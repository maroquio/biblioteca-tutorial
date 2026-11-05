import { expect, test } from "bun:test";
import { api, testReaders, testName } from "#tests/api";
import { createRedis } from "../../../../infrastructure/redis";
import { PostgresReaderHistory } from "../../../../integration/PostgresReaderHistory";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";
import { testReader } from "#tests/reader-fixtures";

async function search(q: string) {
  const response = await api("GET", `/reader?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string }[] };
}

test("UC10: a segunda busca vem do cache", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: espaços nas pontas e maiúsculas compartilham o resultado", async () => {
  const reader = await testReader();
  expect((await search(reader.nome)).cache).toBe("MISS");
  expect((await search(`  ${reader.nome.toUpperCase()}  `)).cache).toBe("HIT");
});

test("UC10: sem q e com q vazio compartilham o resultado", async () => {
  await invalidateReaderSearch();
  expect((await search()).cache).toBe("MISS");
  expect((await search("")).cache).toBe("HIT");
});

test("UC10: cadastrar, editar e excluir autor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some((a) => a.id === reader.id)).toBe(true);

  const renamed = testName("Autor");
  await search(renamed);
  expect((await api("PUT", `/autores/${reader.id}`, { nome: renamed, tipo: "literatura" })).status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map((a) => a.id)).toEqual([reader.id]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  // uma escrita termina entre a leitura no Postgres e a gravação no cache
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", type: "literatura", bookCount: 0 }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde do Postgres", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, readershipIntegration, dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map((a) => a.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});
