import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn, testName } from "#tests/api";

test("listagem de livros traz todos os livros cadastrados", async () => {
  // cria um livro para garantir que a lista não estará vazia
  const author = await testAuthor();
  const input = { isbn: testIsbn(), titulo: testName("Pesquisa"), autorId: author.id };
  const book = await (await api("POST", "/livros", input)).json();
  // faz a requisição para listar os livros
  const response = await api("GET", `/lista-livros`);
  expect(response.status).toBe(200);
  expect((await response.json()).some((l: { id: number }) => l.id === book.id)).toBe(true); 
});
