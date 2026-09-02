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
const EVANS = 1;

/** ISBN-13 sintético com dígito verificador correto — a fase 34 vai conferir. */
function isbnSintetico(seq: number): string {
  const doze = `97800000${String(seq).padStart(4, "0")}`;
  let soma = 0;

  for (let i = 0; i < 12; i++) soma += Number(doze[i]!) * (i % 2 === 0 ? 1 : 3);

  return doze + ((10 - (soma % 10)) % 10);
}

const LIVROS_DE_EVANS = Array.from({ length: 11 }, (_, i) => ({
  isbn: isbnSintetico(i),
  titulo: `Título didático ${i + 1}`,
}));

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

function cadastrar(n: number, autorId = AUSTEN, livros = LIVROS) {
  return fetch(`${BASE}/livros`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...livros[n], autorId }),
  });
}

const cadastrarDeEvans = (n: number) => cadastrar(n, EVANS, LIVROS_DE_EVANS);

test("RF05: um autor de literatura vai até 5 livros no acervo", async () => {
  for (let i = 0; i < 5; i++) {
    const response = await cadastrar(i);
    expect(response.status).toBe(201);
  }

  const sexto = await cadastrar(5);

  expect(sexto.status).toBe(409);
});

test("RF05′: um autor didático vai até 10 livros no acervo", async () => {
  for (let i = 0; i < 10; i++) {
    const response = await cadastrarDeEvans(i);
    expect(response.status).toBe(201);
  }

  const decimoPrimeiro = await cadastrarDeEvans(10);

  expect(decimoPrimeiro.status).toBe(409);
});
