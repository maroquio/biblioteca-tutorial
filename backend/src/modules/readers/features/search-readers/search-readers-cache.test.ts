import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { createRedis, ready, redis } from "../../../../infrastructure/redis";
import { sql } from "../../../../infrastructure/postgres";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { field, generationHash, invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";
import { searchReadersCached } from "./searchReadersCached";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q?: string) {
  const response = await api("GET", q === undefined ? "/leitores" : `/leitores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json<ReaderJson[]>() };
}

test("UC10: a segunda busca vem do cache", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  expect(first.readers).toEqual([reader]);
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: espaços nas pontas, maiúsculas e q ausente ou vazio compartilham o resultado", async () => {
  const reader = await testReader();
  expect((await search(reader.nome)).cache).toBe("MISS");
  const variant = await search(`  ${reader.nome.toUpperCase()} `);
  expect(variant.cache).toBe("HIT");
  expect(variant.readers).toEqual([reader]);

  await invalidateReaderSearch();
  expect((await search()).cache).toBe("MISS");
  expect((await search("")).cache).toBe("HIT");
  expect((await search("   ")).cache).toBe("HIT");
});

test("UC09, UC11 e UC12: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search();
  expect((await search()).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search();
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers).toContainEqual(reader);

  const renamed = testName("Leitor");
  expect((await search(renamed)).readers).toEqual([]);
  const body = { nome: renamed, cpf: testCpf(), email: reader.email, telefone: reader.telefone };
  expect((await api("PUT", `/leitores/${reader.id}`, body)).status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers).toEqual([{ ...reader, nome: renamed, cpf: body.cpf }]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC23: depois do seed a próxima busca é MISS", async () => {
  await search();
  expect((await search()).cache).toBe("HIT");
  expect((await api("POST", "/seed")).status).toBe(200);
  expect((await search()).cache).toBe("MISS");
});

test("UC10: resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  // uma escrita termina entre a leitura no Postgres e a gravação no cache
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", cpf: "52998224725", email: "velho@exemplo.com", phone: "27999991234" }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});

test("UC10: sem Redis a busca responde do Postgres e a invalidação não lança erro", async () => {
  const reader = await testReader();
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const result = await searchReadersCached(reader.nome, new SearchReaders(new PostgresReaderRepository(sql)), dead);
  expect(result.cache).toBe("BYPASS");
  expect(result.readers.map(r => r.id)).toEqual([reader.id]);
  await invalidateReaderSearch(dead);
});

test("UC10: cada termo guardado expira sozinho", async () => {
  const reader = await testReader();
  expect((await search(reader.nome)).cache).toBe("MISS");
  const { generation } = (await readCachedSearch(reader.nome))!;
  const [ttl] = await (await ready(redis!)).send("HTTL", [generationHash(generation), "FIELDS", "1", field(reader.nome)]) as number[];
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(60);
});

/*
 * QUESTÃO 6
 *
 * 1. A busca de leitores é uma consulta só, com ILIKE em quatro colunas. Com
 *    poucas centenas de leitores o Postgres responde rápido e o cache quase não
 *    economiza; passa a compensar com muitos leitores.
 *
 * 2. O cache é uma segunda cópia de CPF, e-mail e telefone. O TTL curto e a falta
 *    de volume diminuem o tempo de vida dessa cópia, mas não a tornam anônima.
 *
 * 3. Com DEL, uma leitura que começou antes da escrita consulta o Postgres sem o
 *    COMMIT, a escrita confirma e apaga a chave, e depois a leitura grava o dado
 *    velho na mesma chave, que fica errada até o TTL. Com geração, essa leitura
 *    grava na geração antiga, que ninguém mais lê.
 *
 * 4. Daria para invalidar só os termos que casam com o nome, e-mail ou CPF antigo
 *    ou novo do leitor, mas isso repete no Redis a regra do ILIKE e da máscara do
 *    CPF. Qualquer diferença entre as duas regras deixa um termo velho no cache,
 *    e a operação passa a virar uma varredura dos campos.
 */
