import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { cleanTestCatalog } from "#tests/clean-catalog";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { createRedis, ready, redis } from "../../../../infrastructure/redis";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

async function search(q?: string) {
  const query = q !== undefined ? `?q=${encodeURIComponent(q)}` : "";
  const response = await api("GET", `/leitores${query}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string; cpf: string }[] };
}

test("UC10: a primeira busca responde MISS e a segunda HIT com o mesmo corpo", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: termos que diferem só em espaços nas pontas ou maiúsculas compartilham resultado", async () => {
  const reader = await testReader();
  await search(reader.nome);
  const variation = `  ${reader.nome.toLowerCase()}  `;
  const result = await search(variation);
  expect(result.cache).toBe("HIT");
  expect(result.readers.some((r) => r.id === reader.id)).toBe(true);
});

test("UC10: sem q e com q vazio compartilham o resultado", async () => {
  await search("");
  const withoutParam = await search(undefined);
  expect(withoutParam.cache).toBe("HIT");
  const emptyParam = await search("");
  expect(emptyParam.cache).toBe("HIT");
  expect(withoutParam.readers).toEqual(emptyParam.readers);
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
  const updateRes = await api("PUT", `/leitores/${reader.id}`, {
    nome: renamed,
    cpf: reader.cpf,
    email: `${crypto.randomUUID()}@exemplo.com`,
    telefone: "27999991234",
  });
  expect(updateRes.status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map((r) => r.id)).toEqual([reader.id]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: depois de um seed (POST /api/seed), a próxima busca é MISS", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const seedRes = await api("POST", "/seed");
  expect(seedRes.status).toBe(200);
  const afterSeed = await search("");
  expect(afterSeed.cache).toBe("MISS");
  await cleanTestCatalog();
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", cpf: "12345678901", email: "velho@ex.com", phone: "27999990000" }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde BYPASS do Postgres e invalidação não falha", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map((r) => r.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});

test("UC10: cada termo guardado tem TTL no hash do Redis", async () => {
  if (!redis) return;
  const client = await ready(redis);
  const term = testName("TtlTerm");
  await search(term);
  const generation = Number(await client.get("biblioteca_test:leitores:buscas:geracao") ?? 0);
  const key = `biblioteca_test:leitores:buscas:${generation}`;
  const fieldKey = `q:${term.trim().toLocaleLowerCase("pt-BR")}`;
  const rawTtl = await client.send("HTTL", [key, "FIELDS", "1", fieldKey]) as number[];
  expect(rawTtl[0]).toBeGreaterThan(0);
  expect(rawTtl[0]).toBeLessThanOrEqual(60);
});
