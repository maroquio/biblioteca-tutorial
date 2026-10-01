import { expect, test } from "bun:test";
import { CadastrarLivro } from "../src/modules/acervo/features/cadastrar-livro/CadastrarLivro";
import {
  FakeEventPublisher,
  InMemoryAutoria,
  InMemoryLivroRepository,
} from "./doubles";

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

/** ISBN-13 sintético com dígito verificador correto — a fase 34 confere. */
function isbnSintetico(seq: number): string {
  const doze = `97800000${String(seq).padStart(4, "0")}`;
  let soma = 0;

  for (let i = 0; i < 12; i++) soma += Number(doze[i]!) * (i % 2 === 0 ? 1 : 3);

  return doze + ((10 - (soma % 10)) % 10);
}

const deAusten = (n: number) => ({ ...LIVROS[n]!, autorId: AUSTEN });

const deEvans = (n: number) => ({
  isbn: isbnSintetico(n),
  titulo: `Título didático ${n + 1}`,
  autorId: EVANS,
});

function scenario(hoje = new Date("2026-03-10")) {
  const livros = new InMemoryLivroRepository();

  const autoria = new InMemoryAutoria({
    [AUSTEN]: { nome: "Jane Austen", tiragem: "curta", livrosNoAcervo: 0 },
    [EVANS]: { nome: "Eric Evans", tiragem: "ampla", livrosNoAcervo: 0 },
  });

  const events = new FakeEventPublisher();

  return {
    livros,
    events,
    useCase: new CadastrarLivro(livros, autoria, () => hoje, events),
  };
}

test("RF04: um autor fora da base é recusado", async () => {
  const { useCase } = scenario();

  await expect(useCase.execute({ ...deAusten(0), autorId: 99 })).rejects.toThrow(
    "Autor não cadastrado",
  );
});

test("RF05: um autor de literatura vai até 5 livros no acervo", async () => {
  const { useCase } = scenario();

  for (let i = 0; i < 5; i++) await useCase.execute(deAusten(i));

  await expect(useCase.execute(deAusten(5))).rejects.toThrow(
    "O autor já tem 5 livros no acervo",
  );
});

test("RF05′: um autor didático vai até 10 livros no acervo", async () => {
  const { useCase } = scenario();

  for (let i = 0; i < 10; i++) await useCase.execute(deEvans(i));

  await expect(useCase.execute(deEvans(10))).rejects.toThrow(
    "O autor já tem 10 livros no acervo",
  );
});

test("RF06 e RF07: a data e o número de registro vêm do servidor, sequenciais no ano", async () => {
  const { useCase } = scenario();

  const primeiro = await useCase.execute(deAusten(0));
  const segundo = await useCase.execute(deEvans(0));

  expect(primeiro.dataCatalogacao).toBe("2026-03-10");
  expect(primeiro.numeroRegistro).toBe("2026-000001");
  expect(segundo.numeroRegistro).toBe("2026-000002");
});

test("RF07: o sequencial recomeça a cada ano", async () => {
  const { livros } = scenario();

  const autoria = new InMemoryAutoria({
    [AUSTEN]: { nome: "Jane Austen", tiragem: "curta", livrosNoAcervo: 0 },
  });

  const events = new FakeEventPublisher();

  const em2026 = new CadastrarLivro(
    livros,
    autoria,
    () => new Date("2026-12-31"),
    events,
  );

  const em2027 = new CadastrarLivro(
    livros,
    autoria,
    () => new Date("2027-01-02"),
    events,
  );

  expect((await em2026.execute(deAusten(0))).numeroRegistro).toBe("2026-000001");
  expect((await em2027.execute(deAusten(1))).numeroRegistro).toBe("2027-000001");
});

test("RF08: o mesmo ISBN não entra duas vezes", async () => {
  const { useCase } = scenario();

  await useCase.execute(deAusten(0));

  await expect(useCase.execute(deAusten(0))).rejects.toThrow("Livro já cadastrado");
});

test("RF09: o mesmo autor não repete título, mesmo com outro ISBN", async () => {
  const { useCase } = scenario();

  await useCase.execute(deAusten(0)); // Orgulho e Preconceito

  await expect(
    useCase.execute({
      isbn: "9780141439563",
      titulo: "orgulho e preconceito", // outro ISBN, mesmo título
      autorId: AUSTEN,
    }),
  ).rejects.toThrow("Este autor já tem um livro com este título");
});

test("o cadastro anuncia LivroCatalogado", async () => {
  const { useCase, events } = scenario();

  await useCase.execute(deAusten(0));

  expect(events.published).toEqual([
    {
      nome: "LivroCatalogado",
      autorId: AUSTEN,
      numeroRegistro: "2026-000001",
      em: "2026-03-10",
    },
  ]);
});
