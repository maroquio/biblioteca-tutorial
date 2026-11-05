import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { createRedis, redis, redisKey } from "../../../../infrastructure/redis";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { searchReadersCached } from "./searchReadersCached";
import { sql } from "../../../../infrastructure/postgres";

async function search(q: string) {
  const response = await api("GET", `/leitores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string; cpf: string }[] };
}

test("UC10: a primeira busca responde MISS e a segunda HIT com mesmo corpo", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: termos que diferem em espaços nas pontas ou maiúsculas compartilham o resultado", async () => {
  const reader = await testReader();
  const lower = reader.nome.toLowerCase();
  const paddedUpper = `   ${reader.nome.toUpperCase()}   `;

  const first = await search(lower);
  expect(first.cache).toBe("MISS");
  const second = await search(paddedUpper);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: sem q e com q vazio compartilham o resultado", async () => {
  const emptyRes = await api("GET", "/leitores?q=");
  expect(emptyRes.status).toBe(200);
  expect(emptyRes.headers.get("X-Cache")).toBe("MISS");

  const noQueryRes = await api("GET", "/leitores");
  expect(noQueryRes.status).toBe(200);
  expect(noQueryRes.headers.get("X-Cache")).toBe("HIT");
  expect(await noQueryRes.json()).toEqual(await emptyRes.json());
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");

  // cadastrar
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some(r => r.id === reader.id)).toBe(true);

  // aquecer cache do nome do leitor
  const warm = await search(reader.nome);
  expect((await search(reader.nome)).cache).toBe("HIT");

  // editar
  const newName = testName("Leitor Alterado");
  const updateRes = await api("PUT", `/leitores/${reader.id}`, {
    nome: newName,
    cpf: reader.cpf,
    email: `${crypto.randomUUID()}@exemplo.com`,
    telefone: "27999998888",
  });
  expect(updateRes.status).toBe(200);

  const afterUpdateOldName = await search(reader.nome);
  expect(afterUpdateOldName.cache).toBe("MISS");
  expect(afterUpdateOldName.readers.some(r => r.id === reader.id)).toBe(false);

  const afterUpdateNewName = await search(newName);
  expect(afterUpdateNewName.cache).toBe("MISS");
  expect(afterUpdateNewName.readers.some(r => r.id === reader.id)).toBe(true);

  // aquecer cache novamente
  expect((await search(newName)).cache).toBe("HIT");

  // excluir
  const deleteRes = await api("DELETE", `/leitores/${reader.id}`);
  expect(deleteRes.status).toBe(204);

  const afterDelete = await search(newName);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers.some(r => r.id === reader.id)).toBe(false);
});

test("UC10: depois de um seed (POST /api/seed), a próxima busca é MISS", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");

  // Invalidação provocada por carga direta/seed através do refreshDerivedData
  const { refreshDerivedData } = await import("../../../../integration/derivedData");
  await refreshDerivedData();

  const afterSeed = await search("");
  expect(afterSeed.cache).toBe("MISS");
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("TermoLeitor");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();

  // Uma escrita termina entre a leitura no Postgres e a gravação no cache
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 999999, name: "Velho", cpf: "11122233344", email: "velho@ex.com", phone: "27999999999" }]);

  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde BYPASS com leitores certos e invalidação não falha", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const repo = new PostgresReaderRepository(sql);

  const result = await searchReadersCached(reader.nome, repo, dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map(r => r.id)).toContain(reader.id);

  // Invalidação com redis morto não deve lançar exceção
  await invalidateReaderSearch(dead);
});

test("UC10: cada termo guardado expira sozinho (TTL)", async () => {
  const reader = await testReader();
  const term = reader.nome;
  await search(term);

  // Consulta HTTL no Redis para a chave da geração e campo do termo
  if (redis) {
    const generationKey = redisKey("leitores", "buscas", "geracao");
    const gen = Number(await redis.get(generationKey) ?? 0);
    const hashKey = redisKey("leitores", "buscas", String(gen));
    const fieldName = `q:${term.trim().toLocaleLowerCase("pt-BR")}`;
    const httl = await redis.send("HTTL", [hashKey, "FIELDS", "1", fieldName]);
    // Array com o TTL em segundos retornado pelo HTTL do Redis 8
    expect(Array.isArray(httl)).toBe(true);
    expect(Number(httl[0])).toBeGreaterThan(0);
    expect(Number(httl[0])).toBeLessThanOrEqual(60);
  }
});

