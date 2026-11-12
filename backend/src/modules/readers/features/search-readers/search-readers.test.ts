import { expect, test } from "bun:test";
import { parseReaderInput } from "../../domain/Reader";
import { SearchReaders } from "./SearchReaders";
import { ana, bruno, InMemoryReaderRepository } from "#tests/reader-doubles";
import { api, testName } from "#tests/api";
import { testReader } from "#tests/reader-fixtures";

type ReaderJson = Awaited<ReturnType<typeof testReader>>;

async function search(q: string) {
  const response = await api("GET", `/leitores?q=${encodeURIComponent(q)}`);
  expect(response.status).toBe(200);
  return { cache: response.headers.get("X-Cache"), readers: await response.json() as { id: number; nome: string; }[] };
}

test("UC10: a segunda busca vem do cache", async () => {
  const reader = await testReader();
  const first = await search(reader.nome);
  expect(first.cache).toBe("MISS");
  const second = await search(reader.nome);
  expect(second.cache).toBe("HIT");
  expect(second.readers).toEqual(first.readers);
});

test("UC10: cadastrar, editar e excluir leitor invalidam o cache", async () => {
  await search("");
  expect((await search("")).cache).toBe("HIT");
  const reader = await testReader();
  const afterCreate = await search("");
  expect(afterCreate.cache).toBe("MISS");
  expect(afterCreate.readers.some((a) => a.id === reader.id)).toBe(true);

  const renamed = testName("Leitor");
  await search(renamed);
  expect((await api("PUT", `/leitores/${reader.id}`)).status).toBe(200);
  const afterUpdate = await search(renamed);
  expect(afterUpdate.cache).toBe("MISS");
  expect(afterUpdate.readers.map((a) => a.id)).toEqual([reader.id]);

  expect((await api("DELETE", `/autores/${reader.id}`)).status).toBe(204);
  const afterDelete = await search(renamed);
  expect(afterDelete.cache).toBe("MISS");
  expect(afterDelete.readers).toEqual([]);
});

test("UC10 consulta retorna lista vazia, nome, CPF e identificador", async () => {
  const repo = new InMemoryReaderRepository();
  await repo.insert(parseReaderInput(ana)); await repo.insert(parseReaderInput(bruno));
  const search = new SearchReaders(repo);
  expect(await search.execute("ANA")).toHaveLength(1);
  expect((await search.execute("52998224725"))[0]!.name).toBe("Ana Silva");
  expect(await search.execute("inexistente")).toEqual([]);
  expect(await search.get(2)).toMatchObject(parseReaderInput(bruno));
  await expect(search.get(99)).rejects.toThrow("não encontrado");
});

test("UC10 API: busca por nome, CPF pontuado e consulta individual", async () => {
  const reader = await testReader();
  const list = await api("GET", `/leitores?q=${encodeURIComponent(reader.nome)}`);
  expect(list.status).toBe(200);
  expect(await list.json<ReaderJson[]>()).toContainEqual(reader);
  const cpf = reader.cpf;
  const masked = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
  expect(await (await api("GET", `/leitores?q=${masked}`)).json<ReaderJson[]>()).toContainEqual(reader);
  expect(await (await api("GET", `/leitores/${reader.id}`)).json<ReaderJson>()).toEqual(reader);
  expect((await api("GET", "/leitores/2147483647")).status).toBe(404);
  expect((await api("GET", "/leitores/invalido")).status).toBe(400);
});

