import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { catalogIntegration } from "../../../../integration/catalogIntegration";
import { ServiceUnavailable } from "../../../../shared/errors";
import { searchBooksSemantically } from "./searchBooksSemantically";

// a suíte roda com EMBEDDING_PROVIDER=hash: "significado" aqui é sobreposição de palavras
type Result = { id: number; titulo: string; distancia: number };

async function createBook(title: string, authorId: number): Promise<{ id: number }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

async function search(q: string): Promise<{ status: number; results: Result[] }> {
  const response = await api("GET", `/busca-semantica/livros?q=${encodeURIComponent(q)}`);
  return { status: response.status, results: await response.json() };
}

function token(): string {
  return crypto.randomUUID().slice(0, 8);
}

test("UC24: ordena pelo significado e corta pelo limiar", async () => {
  const author = await testAuthor();
  const tok = token();
  const sea = await createBook(`Vingança no mar ${tok}`, author.id);
  const cake = await createBook(`Receitas de bolo ${token()}`, author.id);
  const { status, results } = await search(`vingança mar ${tok}`);
  expect(status).toBe(200);
  expect(results[0]!.id).toBe(sea.id);
  expect(results.some((r) => r.id === cake.id)).toBe(false);
  expect(typeof results[0]!.distancia).toBe("number");
});

test("UC24: termo sem relação devolve lista vazia", async () => {
  // várias palavras: com o embedder de hash, uma palavra só que colida com outra de um
  // título curto já ficaria abaixo do limiar
  const { status, results } = await search(`xyzzy${token()} plugh${token()} frobnitz${token()}`);
  expect(status).toBe(200);
  expect(results).toEqual([]);
});

test("UC24: livro excluído não aparece", async () => {
  const author = await testAuthor();
  const tok = token();
  const book = await createBook(`Farol esquecido ${tok}`, author.id);
  expect((await search(`farol esquecido ${tok}`)).results.some((r) => r.id === book.id)).toBe(true);
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect((await search(`farol esquecido ${tok}`)).results.some((r) => r.id === book.id)).toBe(false);
});

test("UC24: termo vazio ou longo demais é 400", async () => {
  expect((await search("  ")).status).toBe(400);
  expect((await search("a".repeat(201))).status).toBe(400);
});

test("UC24: sem embedder a busca é 503", async () => {
  await expect(searchBooksSemantically("x", catalogIntegration, { embedder: null })).rejects.toBeInstanceOf(ServiceUnavailable);
});

test("UC24: a rota não colide com GET /livros/:q", async () => {
  const author = await testAuthor();
  const tok = token();
  await createBook(`Rota própria ${tok}`, author.id);
  const { results } = await search(`rota própria ${tok}`);
  expect(results[0]).toHaveProperty("distancia");
});
