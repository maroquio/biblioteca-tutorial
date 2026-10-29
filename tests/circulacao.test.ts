import { expect, test } from "bun:test";
import { DevolverLivro } from "../src/modules/circulacao/features/devolver-livro/DevolverLivro";
import { EmprestarLivro } from "../src/modules/circulacao/features/emprestar-livro/EmprestarLivro";
import { RuleViolation } from "../src/shared/domain-errors";
import { NotFound, RuleConflict } from "../src/shared/errors";
import { InMemoryEmprestimoRepository, InMemoryExemplares } from "./doubles";

const LEITORA = "2026101";

function scenario() {
  const emprestimos = new InMemoryEmprestimoRepository();
  const exemplares = new InMemoryExemplares({
    "2026-000001": { titulo: "Emma", emprestavel: true },
    "2026-000002": { titulo: "Persuasão", emprestavel: true },
    "2026-000003": { titulo: "Lady Susan", emprestavel: true },
    "2026-000004": { titulo: "Orgulho e Preconceito", emprestavel: true },
    "2026-000005": { titulo: "Razão e Sensibilidade", emprestavel: false },
  });

  // um relógio que o teste pode adiantar
  const relogio = { hoje: new Date("2026-09-01") };
  const now = () => relogio.hoje;

  return {
    relogio,
    emprestar: new EmprestarLivro(emprestimos, exemplares, now),
    devolver: new DevolverLivro(emprestimos, exemplares, now),
  };
}

const pedido = (numeroRegistro: string, matricula = LEITORA) => ({
  numeroRegistro,
  matricula,
});

test("o empréstimo vale por 14 dias a partir de hoje", () => {
  const { emprestar } = scenario();

  const emprestimo = emprestar.execute(pedido("2026-000001"));

  expect(emprestimo.titulo).toBe("Emma");
  expect(emprestimo.emprestadoEm).toBe("2026-09-01");
  expect(emprestimo.devolverAte).toBe("2026-09-15");
  expect(emprestimo.devolvidoEm).toBeNull();
});

test("exemplar que o Acervo não conhece devolve NotFound", () => {
  const { emprestar } = scenario();

  expect(() => emprestar.execute(pedido("2026-999999"))).toThrow(NotFound);
});

test("exemplar que saiu do acervo não é emprestado", () => {
  const { emprestar } = scenario();

  expect(() => emprestar.execute(pedido("2026-000005"))).toThrow(RuleConflict);
});

test("exemplar emprestado não sai de novo antes de voltar", () => {
  const { emprestar } = scenario();

  emprestar.execute(pedido("2026-000001"));

  expect(() => emprestar.execute(pedido("2026-000001", "2026202"))).toThrow(
    RuleConflict,
  );
});

test("o leitor tem no máximo 3 empréstimos em aberto", () => {
  const { emprestar } = scenario();

  emprestar.execute(pedido("2026-000001"));
  emprestar.execute(pedido("2026-000002"));
  emprestar.execute(pedido("2026-000003"));

  expect(() => emprestar.execute(pedido("2026-000004"))).toThrow(RuleViolation);
});

test("a devolução no prazo não tem atraso e libera o exemplar", () => {
  const { emprestar, devolver, relogio } = scenario();
  const emprestimo = emprestar.execute(pedido("2026-000001"));

  relogio.hoje = new Date("2026-09-10");
  const devolvido = devolver.execute(emprestimo.id);

  expect(devolvido.devolvidoEm).toBe("2026-09-10");
  expect(devolvido.diasDeAtraso).toBe(0);
  expect(emprestar.execute(pedido("2026-000001", "2026202")).id).toBe(2);
});

test("a devolução depois do prazo conta os dias de atraso", () => {
  const { emprestar, devolver, relogio } = scenario();
  const emprestimo = emprestar.execute(pedido("2026-000001"));

  relogio.hoje = new Date("2026-09-21");

  expect(devolver.execute(emprestimo.id).diasDeAtraso).toBe(6);
});

test("um empréstimo não é devolvido duas vezes", () => {
  const { emprestar, devolver } = scenario();
  const emprestimo = emprestar.execute(pedido("2026-000001"));

  devolver.execute(emprestimo.id);

  expect(() => devolver.execute(emprestimo.id)).toThrow(RuleViolation);
});
