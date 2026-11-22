import { expect, test } from "bun:test";
import { api, apiForm, testBook } from "#tests/api";
import { imageForm, PNG } from "#tests/images";
import { getObject } from "../../../../infrastructure/storage";
import { coverKey } from "../../infrastructure/covers";

test("UC04: exclusão física aceita livro sem exemplares e recusa livro vinculado", async () => {
  const unlinked = await testBook();
  expect((await api("DELETE", `/livros/${unlinked.id}`)).status).toBe(204);
  expect((await api("DELETE", `/livros/${unlinked.id}`)).status).toBe(404);
  const linked = await testBook();
  expect((await api("POST", "/exemplares", { livroId: linked.id, localizacao: "A1", estadoConservacao: "bom" })).status).toBe(201);
  expect((await api("DELETE", `/livros/${linked.id}`)).status).toBe(409);
});

test("UC04: excluir o livro apaga a capa do bucket", async () => {
  const book = await testBook();
  expect((await apiForm("PUT", `/livros/${book.id}/capa`, imageForm("capa", PNG))).status).toBe(200);
  expect(await getObject(coverKey(book.id))).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await getObject(coverKey(book.id))).toBeNull();
});
