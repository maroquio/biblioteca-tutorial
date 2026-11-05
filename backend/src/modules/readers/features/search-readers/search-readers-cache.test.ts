import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { cleanTestCatalog } from "#tests/clean-catalog";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { sql } from "../../../../infrastructure/postgres";
import { createRedis, ready, redis } from "../../../../infrastructure/redis";
import { inTransaction } from "../../../../infrastructure/transaction";
import { prepareSeed } from "../../../../integration/seed/schema";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { field, generationHash, invalidateReaderSearch, readCachedSearch, TTL_SECONDS, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(path: string) {
  const response = await api("GET", path);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json<ReaderJson[]>() };
}

const byTerm = (q: string) => search(`/leitores?q=${encodeURIComponent(q)}`);

async function resetSeed() {
  await cleanTestCatalog();
  await prepareSeed(sql);
  await inTransaction(async tx => {
    await tx`DELETE FROM leitores WHERE id IN (SELECT registro_id FROM seed_registros WHERE entidade = 'leitores')`;
    await tx`DELETE FROM seed_registros`;
    await tx`DELETE FROM seed_execucoes`;
    await tx`UPDATE autores SET livros_no_acervo = 0`;
  });
}

test("UC10: a segunda busca vem do cache", async () => {
  const reader = await testReader();
  const first = await byTerm(reader.nome);
  expect(first.cache).toBe("MISS");
  expect(first.readers).toEqual([reader]);
  const second = await byTerm(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: espaços nas pontas e maiúsculas caem no mesmo resultado", async () => {
  const reader = await testReader();
  expect((await byTerm(reader.nome.toLowerCase())).cache).toBe("MISS");
  const other = await byTerm(`  ${reader.nome.toUpperCase()}  `);
  expect(other.cache).toBe("HIT");
  expect(other.readers).toEqual([reader]);
});

test("UC10: sem q e com q vazio compartilham o resultado", async () => {
  await invalidateReaderSearch();
  const withoutQ = await search("/leitores");
  expect(withoutQ.cache).toBe("MISS");
  const emptyQ = await search("/leitores?q=");
  expect(emptyQ.cache).toBe("HIT");
  expect(emptyQ.readers).toEqual(withoutQ.readers);
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("/leitores");
  expect((await search("/leitores")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("/leitores");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers).toContainEqual(reader);

  const renamed = { ...reader, nome: testName("Leitor"), telefone: "27988887777" };
  await byTerm(renamed.nome);
  expect((await byTerm(renamed.nome)).cache).toBe("HIT");
  expect((await api("PUT", `/leitores/${reader.id}`, renamed)).status).toBe(200);
  const afterUpdate = await byTerm(renamed.nome);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers).toEqual([renamed]);

  expect((await byTerm(renamed.nome)).cache).toBe("HIT");
  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await byTerm(renamed.nome);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10: uma escrita que falha não invalida o cache", async () => {
  const reader = await testReader();
  await byTerm(reader.nome);
  const repeated = { nome: testName("Leitor"), cpf: reader.cpf, email: `${crypto.randomUUID()}@exemplo.com`, telefone: "27999991234" };
  expect((await api("POST", "/leitores", repeated)).status).toBe(409);
  expect((await byTerm(reader.nome)).cache).toBe("HIT");
});

test("UC10: o seed escreve direto na tabela e invalida o cache", async () => {
  await resetSeed();
  try {
    await search("/leitores");
    expect((await search("/leitores")).cache).toBe("HIT");
    expect((await api("POST", "/seed")).status).toBe(200);
    expect((await search("/leitores")).cache).toBe("MISS");
  } finally {
    await resetSeed();
  }
});

test("UC10: resultado antigo gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Antigo", cpf: testCpf(), email: "antigo@exemplo.com", phone: "27999991234" }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde do Postgres e a invalidação não lança erro", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, new PostgresReaderRepository(sql), dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map((r) => r.id)).toEqual([reader.id]);
  await expect(invalidateReaderSearch(dead)).resolves.toBeUndefined();
});

test("UC10: cada termo guardado expira sozinho", async () => {
  const reader = await testReader();
  expect((await byTerm(reader.nome)).cache).toBe("MISS");
  const { generation } = (await readCachedSearch(reader.nome))!;
  const [ttl] = await (await ready(redis!)).send("HTTL", [generationHash(generation), "FIELDS", "1", field(reader.nome)]) as number[];
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(TTL_SECONDS);
});
