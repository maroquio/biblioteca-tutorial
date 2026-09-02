import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { db } from "../src/db";

const BASE = "http://localhost:3000";
const AUSTEN = 4;
const LIVROS = [
  { isbn: "9780141439518", titulo: "Orgulho e Preconceito" },
  { isbn: "9780141439662", titulo: "Razão e Sensibilidade" },
  { isbn: "9780141439587", titulo: "Emma" },
  { isbn: "9780141439761", titulo: "Persuasão" },
  { isbn: "9780141439563", titulo: "A Abadia de Northanger" },
  { isbn: "9780141199689", titulo: "Lady Susan" },
];

let server: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  // não há como exercitar a regra sem subir a aplicação inteira
  server = Bun.spawn(["bun", "src/index.ts"], { stdout: "ignore" });

  // ... e sem esperar a porta abrir
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
  // ... e sem limpar o banco de verdade entre um teste e outro
  db.run("DELETE FROM livros");
});

function cadastrar(n: number, autorId = AUSTEN): Promise<Response> {
  return fetch(`${BASE}/livros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...LIVROS[n], autorId }),
  });
}

test("RF05: o autor não pode ter mais de 3 livros no acervo", async () => {
  for (let i = 0; i < 3; i++) {
    const response = await cadastrar(i);
    expect(response.status).toBe(201);
  }

  const quarto = await cadastrar(3);

  expect(quarto.status).toBe(409);
});
