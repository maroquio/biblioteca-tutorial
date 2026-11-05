import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { cleanTestCatalog } from "#tests/clean-catalog";
import { testReader } from "#tests/reader-fixtures";
import { createRedis, ready, redis, redisKey } from "../../../../infrastructure/redis";
import { sql } from "../../../../infrastructure/postgres";
import { parseReaderInput } from "../../domain/Reader";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q?: string) {
  const response = await api("GET", q === undefined ? "/leitores" : `/leitores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json<ReaderJson[]>() };
}

test("UC10: a segunda busca vem do cache com o mesmo corpo", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  expect(first.readers).toEqual([reader]);
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
  const individual = await api("GET", `/leitores/${reader.id}`);
  expect(individual.headers.get("X-Cache")).toBeNull();
  expect(await individual.json<ReaderJson>()).toEqual(reader);
});

test("UC10: espaços nas pontas e maiúsculas compartilham o cache", async () => {
  const reader = await testReader();
  const first = await search(`  ${reader.nome.toUpperCase()}  `);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome.toLowerCase());
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual([reader]);
  expect(second.readers).toEqual(first.readers);
});

test("UC10: sem q e com q vazio compartilham o cache", async () => {
  await testReader();
  const first = await search();
  expect(first.cache).toBe("MISS");
  const second = await search("");
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: resultados vazios também ficam no cache", async () => {
  const term = testName("Inexistente");
  expect(await search(term)).toEqual({ cache: "MISS", readers: [] });
  expect(await search(term)).toEqual({ cache: "HIT", readers: [] });
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers).toContainEqual(reader);

  const updated = { ...reader, nome: testName("Leitor editado"), email: `${crypto.randomUUID()}@exemplo.com` };
  await search(updated.nome);
  expect((await search(updated.nome)).cache).toBe("HIT");
  expect((await api("PUT", `/leitores/${reader.id}`, updated)).status).toBe(200);
  const afterUpdate = await search(updated.nome);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers).toEqual([updated]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  expect(await search(updated.nome)).toEqual({ cache: "MISS", readers: [] });
});

test("UC10: o seed invalida as buscas de leitores", async () => {
  if (!new URL(process.env.DATABASE_URL!).pathname.endsWith("_test")) {
    throw new Error("O teste do seed exige um banco terminado em _test.");
  }
  const term = "Leitor Fictício";
  await search(term);
  expect((await search(term)).cache).toBe("HIT");
  const response = await api("POST", "/seed");
  expect(response.status, await response.clone().text()).toBe(200);
  const result = await response.json<{ criado: boolean }>();
  try {
    const afterSeed = await search(term);
    expect(afterSeed.cache).toBe("MISS");
    expect(afterSeed.readers).toHaveLength(120);
    expect((await search(term)).cache).toBe("HIT");
  } finally {
    if (result.criado) {
      await cleanTestCatalog();
      await sql.begin(async tx => {
        await tx`DELETE FROM leitores WHERE id IN (SELECT registro_id FROM seed_registros WHERE entidade = 'leitores')`;
        await tx`DELETE FROM seed_registros`;
        await tx`DELETE FROM seed_execucoes`;
        await tx`UPDATE autores SET livros_no_acervo = 0`;
      });
      await invalidateReaderSearch();
    }
  }
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const reader = await testReader();
  const read = await readCachedSearch(reader.nome);
  expect(read!.readers).toBeNull();
  const updated = { ...reader, nome: testName("Leitor novo") };
  expect((await api("PUT", `/leitores/${reader.id}`, updated)).status).toBe(200);
  await writeCachedSearch(reader.nome, read!.generation, [{ id: reader.id, ...parseReaderInput(reader) }]);
  expect((await readCachedSearch(reader.nome))!.readers).toBeNull();
  expect(await search(reader.nome)).toEqual({ cache: "MISS", readers: [] });
  expect((await search(updated.nome)).readers).toEqual([updated]);
});

test("UC10: sem Redis a busca responde do Postgres e a invalidação não falha", async () => {
  const reader = await testReader();
  const repository = new PostgresReaderRepository(sql);
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  try {
    for (const client of [dead, null]) {
      const result = await searchReadersCached(reader.nome, repository, client);
      expect(result.cache).toBe("BYPASS");
      expect(result.readers).toEqual([{ id: reader.id, ...parseReaderInput(reader) }]);
      await invalidateReaderSearch(client);
    }
  } finally {
    dead.close();
  }
});

test("UC10: cada termo tem seu próprio TTL no hash da geração", async () => {
  const reader = await testReader();
  await search(reader.nome);
  await search(reader.email);
  const cached = await readCachedSearch(reader.nome);
  const client = await ready(redis!);
  const key = redisKey("leitores", "buscas", String(cached!.generation));
  const fields = [reader.nome.toLocaleLowerCase("pt-BR"), reader.email].map(term => `q:${term}`);
  const ttls = await client.send("HTTL", [key, "FIELDS", "2", ...fields]) as number[];
  expect(ttls).toHaveLength(2);
  for (const ttl of ttls) {
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  }
  await client.send("HEXPIRE", [key, "1", "FIELDS", "1", fields[0]!]);
  await Bun.sleep(1100);
  expect((await readCachedSearch(reader.nome))!.readers).toBeNull();
  expect((await search(reader.email)).cache).toBe("HIT");
  expect((await search(reader.nome)).cache).toBe("MISS");
});
