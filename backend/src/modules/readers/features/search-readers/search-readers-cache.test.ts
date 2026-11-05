import { PostgresReaderRepository } from './../../infrastructure/PostgresReaderRepository';
import { expect, test } from "bun:test";
import { api, testIsbn, testName } from "#tests/api";
import { createRedis } from "../../../../infrastructure/redis";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch} from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";
import { testReader } from "#tests/reader-fixtures";
import { sql } from '../../../../infrastructure/postgres';

async function search(q: string) {
  const response = await api("GET", `/leitores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string }[] };
}

test("UC06: a segunda busca vem do cache", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("Depois de um seed (POST /api/seed), a próxima busca é MISS.", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  await api("POST", "/seed");
  const third = await search(reader.nome);
  expect(third.cache).toBe("MISS");
  expect(third.readers).toEqual(first.readers);
});

test("Termos que diferem só em espaços nas pontas ou em maiúsculas compartilham o resultado: a segunda busca é HIT.", async () => {
  const reader = await testReader();
  const first = await search(reader.nome); // nome é Leitor
  expect(first.cache).toBe("MISS");
  const second = await search("LEITOR ");
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("Sem q e com q vazio compartilham o resultado.", async () => {
  const reader = await testReader();
  const first = await search(''); // nome é Leitor
  expect(first.cache).toBe("MISS");
  const second = await search("");
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some((a) => a.id === reader.id)).toBe(true);

  const renamed = testName("Leitor");
  await search(renamed);
  expect((await api("PUT", `/leitores/${reader.id}`, { nome: renamed, tipo: "literatura" })).status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map((a) => a.id)).toEqual([reader.id]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("Um resultado gravado numa geração antiga, depois de uma invalidação, não é lido (o teste da corrida, como o de autores).", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  // uma escrita termina entre a leitura no Postgres e a gravação no cache
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", cpf: "12345678900", email: "velho@example.com", phone: "1234567890" }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("Com um cliente Redis apontando para um servidor inexistente, a busca responde BYPASS com os leitores certos, e a invalidação não lança erro.", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, new PostgresReaderRepository(sql), dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map((a) => a.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});
