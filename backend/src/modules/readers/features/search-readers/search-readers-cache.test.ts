import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testReader } from "#tests/reader-fixtures";
import { sql } from "../../../../infrastructure/postgres";
import { createRedis, ready, redis, redisKey } from "../../../../infrastructure/redis";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q?: string) {
  const response = await api("GET", q === undefined ? "/leitores" : `/leitores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json<ReaderJson[]>() };
}

test("UC10: a segunda busca vem do cache, com o mesmo corpo", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
  expect(second.readers).toContainEqual(reader);
});

test("UC10: espaços nas pontas e maiúsculas compartilham o resultado", async () => {
  const reader = await testReader();
  expect((await search(reader.nome)).cache).toBe("MISS");
  expect((await search(`  ${reader.nome.toUpperCase()} `)).cache).toBe("HIT");
});

test("UC10: sem q e com q vazio compartilham o resultado", async () => {
  await invalidateReaderSearch();
  expect((await search()).cache).toBe("MISS");
  expect((await search("")).cache).toBe("HIT");
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some(r => r.id === reader.id)).toBe(true);

  const renamed = testName("Leitor");
  await search(renamed);
  expect((await search(renamed)).cache).toBe("HIT");
  const put = await api("PUT", `/leitores/${reader.id}`, { nome: renamed, cpf: reader.cpf, email: reader.email, telefone: reader.telefone });
  expect(put.status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map(r => r.id)).toEqual([reader.id]);

  expect((await search(renamed)).cache).toBe("HIT");
  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: depois de um seed a próxima busca é MISS", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  expect((await api("POST", "/seed")).status).toBeLessThan(300);
  expect((await search("")).cache).toBe("MISS");
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", cpf: "00000000000", email: "v@exemplo.com", phone: "27999991234" }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde do Postgres e a invalidação não lança", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, new SearchReaders(new PostgresReaderRepository(sql)), dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map(r => r.id)).toEqual([reader.id]);
  await expect(invalidateReaderSearch(dead)).resolves.toBeUndefined();
});

test("UC10: cada termo guardado expira sozinho (TTL)", async () => {
  const reader = await testReader();
  await search(reader.nome);
  await ready(redis!);
  const generation = await redis!.get(redisKey("leitores", "buscas", "geracao"));
  const ttl = await redis!.send("HTTL", [redisKey("leitores", "buscas", String(generation)), "FIELDS", "1", `q:${reader.nome.toLocaleLowerCase("pt-BR")}`]) as number[];
  expect(ttl[0]).toBeGreaterThan(0);
  expect(ttl[0]).toBeLessThanOrEqual(60);
});
