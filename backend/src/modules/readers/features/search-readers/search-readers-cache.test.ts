import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { sql } from "../../../../infrastructure/postgres";
import { createRedis, redis, redisKey } from "../../../../infrastructure/redis";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

async function get(path: string) {
  const response = await api("GET", path);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string }[] };
}

function search(q: string) {
  return get(`/leitores?q=${encodeURIComponent(q)}`);
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
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(`  ${reader.nome.toUpperCase()}  `);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: sem q e com q vazio compartilham o resultado", async () => {
  await invalidateReaderSearch();
  const first = await get("/leitores");
  expect(first.cache).toBe("MISS");
  const second = await get("/leitores?q=");
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some((r) => r.id === reader.id)).toBe(true);

  const renamed = testName("Leitor");
  await search(renamed);
  const update = await api("PUT", `/leitores/${reader.id}`, { nome: renamed, cpf: reader.cpf, email: reader.email, telefone: reader.telefone });
  expect(update.status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map((r) => r.id)).toEqual([reader.id]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: o seed invalida o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  expect((await api("POST", "/seed")).status).toBe(200);
  expect((await search("")).cache).toBe("MISS");
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", cpf: testCpf(), email: "velho@exemplo.com", phone: "27999991234" }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde do Postgres", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, new PostgresReaderRepository(sql), dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map((r) => r.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});

test("UC10: cada termo guardado expira sozinho", async () => {
  const term = testName("Termo");
  await search(term);
  const read = await readCachedSearch(term);
  const ttl = await redis!.send("HTTL", [redisKey("leitores", "buscas", String(read!.generation)), "FIELDS", "1", `q:${term.toLocaleLowerCase("pt-BR")}`]) as number[];
  expect(ttl[0]).toBeGreaterThan(0);
  expect(ttl[0]).toBeLessThanOrEqual(60);
});