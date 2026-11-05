import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testReader } from "#tests/reader-fixtures";
import { createRedis, redis, redisKey } from "../../../../infrastructure/redis";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { invalidateReaderSearch, readCachedReaderSearch, writeCachedReaderSearch } from "../../infrastructure/searchCache";
import { sql } from "../../../../infrastructure/postgres";
import { searchReadersCached } from "./searchReadersCached";

async function search(q?: string) {
  const suffix = q === undefined ? "" : `?q=${encodeURIComponent(q)}`;
  const response = await api("GET", `/leitores${suffix}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string }[] };
}

test("UC10: busca de leitores usa cache e normaliza o termo", async () => {
  const reader = await testReader();
  const first = await search(`  ${reader.nome.toUpperCase()}  `);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome.toLowerCase());
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);

  expect((await search()).cache).toBe("MISS");
  expect((await search("")).cache).toBe("HIT");
});

test("UC10: cadastrar, editar e excluir leitor invalidam a busca", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some(value => value.id === reader.id)).toBe(true);

  const renamed = testName("Leitor");
  await search(renamed);
  expect((await api("PUT", `/leitores/${reader.id}`, { ...reader, nome: renamed })).status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map(value => value.id)).toEqual([reader.id]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: seed invalida buscas de leitores", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  expect((await api("POST", "/seed")).status).toBe(200);
  expect((await search("")).cache).toBe("MISS");
});

test("UC10: resultado antigo gravado em geração anterior não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedReaderSearch(term);
  expect(read!.readers).toBeNull();
  await invalidateReaderSearch();
  await writeCachedReaderSearch(term, read!.generation, [{ id: 1, name: "Antigo", cpf: "12345678909", email: "antigo@exemplo.com", phone: "27999999999" }]);
  expect((await readCachedReaderSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis busca leitores e invalidação seguem funcionando", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, new PostgresReaderRepository(sql), dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map(value => value.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});

test("UC10: cada termo de busca expira individualmente", async () => {
  const term = testName("TTL");
  const read = await readCachedReaderSearch(term);
  await writeCachedReaderSearch(term, read!.generation, []);
  const key = redisKey("leitores", "buscas", String(read!.generation));
  const ttl = await redis!.send("HTTL", [key, "FIELDS", "1", `q:${term.trim().toLocaleLowerCase("pt-BR")}`]);
  expect(Number(ttl)).toBeGreaterThan(0);
});
