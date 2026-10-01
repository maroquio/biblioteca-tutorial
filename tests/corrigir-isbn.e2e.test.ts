import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { db } from "../src/infrastructure/db";

const BASE = "http://localhost:3998";

let server: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  server = Bun.spawn(["bun", "src/main.ts"], {
    stdout: "ignore",
    env: { ...process.env, PORT: "3998" },
  });

  for (let tentativa = 0; tentativa < 50; tentativa++) {
    try {
      await fetch(BASE);
      return;
    } catch {
      await Bun.sleep(100);
    }
  }

  throw new Error("o servidor não subiu");
});

afterAll(() => {
  server.kill();
});

beforeEach(() => {
  db.run("DELETE FROM livros");
});

test("roteiro completo de correcao de ISBN via HTTP", async () => {
  // 1. Cadastrar dois livros
  const resLivroA = await fetch(`${BASE}/livros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      isbn: "9780141439518",
      titulo: "Livro de teste 5B A",
      autorId: 4,
    }),
  });
  expect(resLivroA.status).toBe(201);
  const livroA = (await resLivroA.json()) as any;

  const resLivroB = await fetch(`${BASE}/livros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      isbn: "9780141439662",
      titulo: "Livro de teste 5B B",
      autorId: 1,
    }),
  });
  expect(resLivroB.status).toBe(201);

  // 2. Corrigir o ISBN com sucesso
  const resCorrigir = await fetch(`${BASE}/livros/${livroA.id}/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "978-0-14-143958-7" }),
  });
  expect(resCorrigir.status).toBe(200);
  const corrigido = await resCorrigir.json();
  expect(corrigido).toEqual({
    id: livroA.id,
    numeroRegistro: livroA.numeroRegistro,
    isbn: "9780141439587",
  });

  // Repetir próprio ISBN deve retornar 200
  const resRepetir = await fetch(`${BASE}/livros/${livroA.id}/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "9780141439587" }),
  });
  expect(resRepetir.status).toBe(200);

  // GET com ISBN novo retorna o livro
  const resGetNovo = await fetch(`${BASE}/livros/9780141439587`);
  expect(resGetNovo.status).toBe(200);
  const listaNovo = (await resGetNovo.json()) as any[];
  expect(listaNovo.length).toBe(1);
  expect(listaNovo[0].id).toBe(livroA.id);
  expect(listaNovo[0].isbn).toBe("9780141439587");
  expect(listaNovo[0].titulo).toBe("Livro de teste 5B A");

  // GET com ISBN antigo retorna vazio
  const resGetAntigo = await fetch(`${BASE}/livros/9780141439518`);
  expect(resGetAntigo.status).toBe(200);
  const listaAntiga = (await resGetAntigo.json()) as any[];
  expect(listaAntiga.length).toBe(0);

  // Cenários de erro
  // ISBN de outro livro -> 409
  const resConflito = await fetch(`${BASE}/livros/${livroA.id}/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "978-0-14-143966-2" }),
  });
  expect(resConflito.status).toBe(409);
  expect(((await resConflito.json()) as any).error).toBeDefined();

  // Livro inexistente -> 404
  const resInexistente = await fetch(`${BASE}/livros/999999/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "9780141439587" }),
  });
  expect(resInexistente.status).toBe(404);
  expect(((await resInexistente.json()) as any).error).toBeDefined();

  // Id inválido -> 400
  const resIdInvalido = await fetch(`${BASE}/livros/0/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "9780141439587" }),
  });
  expect(resIdInvalido.status).toBe(400);
  expect(((await resIdInvalido.json()) as any).error).toBeDefined();

  // ISBN vazio -> 400
  const resVazio = await fetch(`${BASE}/livros/${livroA.id}/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "   " }),
  });
  expect(resVazio.status).toBe(400);
  expect(((await resVazio.json()) as any).error).toBeDefined();

  // ISBN curto -> 400
  const resCurto = await fetch(`${BASE}/livros/${livroA.id}/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "123" }),
  });
  expect(resCurto.status).toBe(400);
  expect(((await resCurto.json()) as any).error).toBeDefined();

  // Dígito verificador incorreto -> 400
  const resDigito = await fetch(`${BASE}/livros/${livroA.id}/isbn`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isbn: "9780141439588" }),
  });
  expect(resDigito.status).toBe(400);
  expect(((await resDigito.json()) as any).error).toBeDefined();
});
