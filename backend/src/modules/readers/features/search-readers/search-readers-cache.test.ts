import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { sql } from "../../../../infrastructure/postgres";
import { createRedis, ready, redis, redisKey } from "../../../../infrastructure/redis";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q?: string) {
  const path = q === undefined ? "/leitores" : `/leitores?q=${encodeURIComponent(q)}`;
  const response = await api("GET", path);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json<ReaderJson[]>() };
}

test("UC10: a segunda busca vem do cache e normaliza espaços e maiúsculas", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  expect(first.readers).toContainEqual(reader);

  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);

  const normalized = await search(`  ${reader.nome.toUpperCase()}  `);
  expect(normalized.cache).toBe("HIT");
  expect(normalized.readers).toEqual(first.readers);
});

test("UC10: busca sem q e com q vazio compartilham o mesmo resultado no cache", async () => {
  await invalidateReaderSearch();
  const withoutQ = await search();
  expect(withoutQ.cache).toBe("MISS");

  const withEmptyQ = await search("");
  expect(withEmptyQ.cache).toBe("HIT");
  expect(withEmptyQ.readers).toEqual(withoutQ.readers);
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");

  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers).toContainEqual(reader);

  const renamed = testName("Leitor");
  await search(renamed);
  expect((await search(renamed)).cache).toBe("HIT");
  const updated = await api("PUT", `/leitores/${reader.id}`, {
    nome: renamed, cpf: reader.cpf, email: reader.email, telefone: reader.telefone,
  });
  expect(updated.status).toBe(200);

  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map(r => r.id)).toEqual([reader.id]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: executar o seed invalida o cache de leitores", async () => {
  const term = testName("Seed");
  expect((await search(term)).cache).toBe("MISS");
  expect((await search(term)).cache).toBe("HIT");

  expect((await api("POST", "/seed")).status).toBe(200);
  expect((await search(term)).cache).toBe("MISS");
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [
    { id: 1, name: "Velho", cpf: testCpf(), email: "velho@exemplo.com", phone: "27999990000" },
  ]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: cada termo guardado define TTL próprio no Redis", async () => {
  const term = testName("Ttl");
  await search(term);
  const read = await readCachedSearch(term);
  const client = await ready(redis!);
  const key = redisKey("leitores", "buscas", String(read!.generation));
  const field = `q:${term.trim().toLocaleLowerCase("pt-BR")}`;
  const [ttl] = await client.send("HTTL", [key, "FIELDS", "1", field]) as number[];
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(60);
});

test("UC10: sem Redis a busca responde do Postgres", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, new PostgresReaderRepository(sql), dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map(r => r.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});
