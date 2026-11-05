import { beforeEach, expect, test } from "bun:test";
import { api } from "#tests/api";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { createRedis, ready, redis, redisKey } from "../../../../infrastructure/redis";
import { sql } from "../../../../infrastructure/postgres";
import { refreshDerivedData } from "../../../../integration/derivedData";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import {
  invalidateReaderSearch,
  readCachedReaderSearch,
  writeCachedReaderSearch,
} from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

beforeEach(async () => {
  await invalidateReaderSearch();
});

async function search(path: string) {
  const response = await api("GET", path);
  expect(response.status).toBe(200);
  return {
    cache: response.headers.get("X-Cache"),
    readers: await response.json<ReaderJson[]>(),
  };
}

test("UC10: a segunda busca vem do cache", async () => {
  const reader = await testReader();
  const path = `/leitores?q=${encodeURIComponent(reader.nome)}`;

  const first = await search(path);
  expect(first.cache).toBe("MISS");
  expect(first.readers).toContainEqual(reader);

  const second = await search(path);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: caixa e espaços nas pontas compartilham a entrada do cache", async () => {
  const reader = await testReader();
  const first = await search(`/leitores?q=${encodeURIComponent(` ${reader.nome.toUpperCase()} `)}`);
  expect(first.cache).toBe("MISS");

  const second = await search(`/leitores?q=${encodeURIComponent(reader.nome.toLowerCase())}`);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: busca sem q e com q vazio compartilham a entrada do cache", async () => {
  const first = await search("/leitores");
  expect(first.cache).toBe("MISS");

  const second = await search("/leitores?q=");
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = `Leitor ${crypto.randomUUID()}`;
  const read = await readCachedReaderSearch(term);
  expect(read!.readers).toBeNull();

  await invalidateReaderSearch();
  await writeCachedReaderSearch(term, read!.generation, [{
    id: 1,
    name: "Leitor Velho",
    cpf: "52998224725",
    email: "velho@exemplo.com",
    phone: "27999991234",
  }]);

  expect((await readCachedReaderSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde do Postgres e a invalidação não falha", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });

  const result = await searchReadersCached(
    reader.nome,
    new PostgresReaderRepository(sql),
    dead,
  );

  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map(({ id }) => id)).toContain(reader.id);
  await invalidateReaderSearch(dead);
});

test("UC10: cada termo guardado recebe TTL próprio", async () => {
  const reader = await testReader();
  await search(`/leitores?q=${encodeURIComponent(reader.nome)}`);

  const client = await ready(redis!);
  const generation = Number(await client.get(redisKey("leitores", "buscas", "geracao")) ?? 0);
  const ttl = await client.send("HTTL", [
    redisKey("leitores", "buscas", String(generation)),
    "FIELDS",
    "1",
    `q:${reader.nome.trim().toLocaleLowerCase("pt-BR")}`,
  ]) as number[];

  expect(ttl[0]).toBeGreaterThan(0);
  expect(ttl[0]).toBeLessThanOrEqual(60);
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("/leitores?q=");
  expect((await search("/leitores?q=")).cache).toBe("HIT");

  const reader = await testReader();
  const afterCreate = await search("/leitores?q=");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers).toContainEqual(reader);

  const renamed = `Leitor ${crypto.randomUUID()}`;
  await search(`/leitores?q=${encodeURIComponent(renamed)}`);
  const update = await api("PUT", `/leitores/${reader.id}`, {
    nome: renamed,
    cpf: reader.cpf,
    email: reader.email,
    telefone: reader.telefone,
  });
  expect(update.status).toBe(200);

  const afterUpdate = await search(`/leitores?q=${encodeURIComponent(renamed)}`);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map(({ id }) => id)).toContain(reader.id);

  expect((await search(`/leitores?q=${encodeURIComponent(renamed)}`)).cache).toBe("HIT");
  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);

  const afterDelete = await search(`/leitores?q=${encodeURIComponent(renamed)}`);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: atualização de dados derivados invalida escrita direta na tabela", async () => {
  const name = `Leitor direto ${crypto.randomUUID()}`;
  await search(`/leitores?q=${encodeURIComponent(name)}`);
  expect((await search(`/leitores?q=${encodeURIComponent(name)}`)).cache).toBe("HIT");

  await sql`INSERT INTO leitores (nome, cpf, email, telefone) VALUES (
    ${name}, ${testCpf()}, ${`${crypto.randomUUID()}@exemplo.com`}, ${"27999991234"}
  )`;
  await refreshDerivedData();

  const refreshed = await search(`/leitores?q=${encodeURIComponent(name)}`);
  expect(refreshed.cache).toBe("MISS");
  expect(refreshed.readers.some((reader) => reader.nome === name)).toBe(true);
});
