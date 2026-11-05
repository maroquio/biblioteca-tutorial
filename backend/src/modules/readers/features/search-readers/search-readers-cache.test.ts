import { expect, test } from "bun:test";
import { createRedis } from "../../../../infrastructure/redis";
import { sql } from "../../../../infrastructure/postgres";
import { api, testName } from "#tests/api";
import { testReader } from "#tests/reader-fixtures";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import {
  invalidateReaderSearch,
  readCachedSearch,
  writeCachedSearch,
} from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q?: string) {
  const path =
    q === undefined ? "/leitores" : "/leitores?q=" + encodeURIComponent(q);
  const response = await api("GET", path);
  expect(response.status).toBe(200);
  return {
    cache: response.headers.get("X-Cache"),
    readers: await response.json<ReaderJson[]>(),
  };
}

test("A segunda busca vem do cache", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");

  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("Espaços e maiúsculas usam o mesmo cache", async () => {
  const reader = await testReader();
  const first = await search("  " + reader.nome.toUpperCase() + "  ");
  expect(first.cache).toBe("MISS");

  const second = await search(reader.nome.toLowerCase());
  expect(second.cache).toBe("HIT");
});

test("q ausente e q vazio usam o mesmo cache", async () => {
  await invalidateReaderSearch();
  const first = await search();
  expect(first.cache).toBe("MISS");

  const second = await search("");
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC09, UC11 e UC12 invalidam a busca", async () => {
  await invalidateReaderSearch();
  await search("");

  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some((item) => item.id === reader.id)).toBe(true);

  const newName = testName("Leitor atualizado");
  const updated = await api("PUT", "/leitores/" + reader.id, {
    nome: newName,
    cpf: reader.cpf,
    email: reader.email,
    telefone: reader.telefone,
  });
  expect(updated.status).toBe(200);

  const afterUpdate = await search("");
  expect(afterUpdate.cache).toBe("MISS");
  expect(
    afterUpdate.readers.some(
      (item) => item.id === reader.id && item.nome === newName,
    ),
  ).toBe(true);

  const removed = await api("DELETE", "/leitores/" + reader.id);
  expect(removed.status).toBe(204);

  const afterDelete = await search("");
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers.some((item) => item.id === reader.id)).toBe(false);
});

test("UC10: resultado de geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read).not.toBeNull();
  expect(read?.readers).toBeNull();
  if (!read) throw new Error("Redis não disponível no teste");

  await invalidateReaderSearch();
  await writeCachedSearch(term, read.generation, [
    {
      id: 1,
      name: "Leitor antigo",
      cpf: "52998224725",
      email: "antigo@example.com",
      phone: "27999991234",
    },
  ]);

  expect((await readCachedSearch(term))?.readers).toBeNull();
});

test("UC10: sem Redis responde BYPASS e continua no Postgres", async () => {
  const reader = await testReader();
  const deadRedis = createRedis("redis://127.0.0.1:1", {
    autoReconnect: false,
  });
  const result = await searchReadersCached(
    reader.nome,
    new PostgresReaderRepository(sql),
    deadRedis,
  );

  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map((item) => item.id)).toEqual([reader.id]);
  await invalidateReaderSearch(deadRedis);
});
