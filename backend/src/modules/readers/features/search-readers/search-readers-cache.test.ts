import { expect, test } from "bun:test";
import { api, testName } from "#tests/api";
import { testCpf, testReader } from "#tests/reader-fixtures";
import { invalidateReaderSearch, readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q?: string) {
  const response = await api("GET", q === undefined ? "/leitores" : `/leitores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json<ReaderJson[]>() };
}

test("a segunda busca vem do cache", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some(r => r.id === reader.id)).toBe(true);

  const renamed = testName("Leitor");
  await search(renamed);
  const update = await api("PUT", `/leitores/${reader.id}`, { nome: renamed, cpf: reader.cpf, email: reader.email, telefone: reader.telefone });
  expect(update.status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers).toEqual([{ ...reader, nome: renamed }]);

  expect((await api("DELETE", `/leitores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("resultado velho gravado numa geração antiga não é lido", async () => {
  const term = testName("Termo");
  const read = await readCachedSearch(term);
  expect(read!.readers).toBeNull();
  await invalidateReaderSearch();
  await writeCachedSearch(term, read!.generation, [{ id: 1, name: "Velho", cpf: testCpf(), email: "velho@exemplo.com", phone: "28999991234" }]);
  expect((await readCachedSearch(term))!.readers).toBeNull();
});


