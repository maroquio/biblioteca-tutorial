import { expect, test } from "bun:test";
import { CadastrarAutor } from "../src/modules/autoria/features/cadastrar-autor/CadastrarAutor";
import { InvalidValue } from "../src/shared/domain-errors";
import { RuleConflict } from "../src/shared/errors";
import { InMemoryAutorRepository } from "./doubles";

const ORCID_VALIDO = "0000-0002-1825-0097";
const OUTRO_ORCID = "0000-0001-5109-3700";

function scenario() {
  const autores = new InMemoryAutorRepository();

  return { autores, useCase: new CadastrarAutor(autores) };
}

const novo = (over: Record<string, unknown> = {}) => ({
  nome: "Ursula K. Le Guin",
  tipo: "literatura",
  orcid: null as string | null,
  ...over,
});

test("cadastra um autor e devolve a identidade atribuída", () => {
  const { useCase } = scenario();

  const autor = useCase.execute(novo());

  expect(autor.id).toBe(1);
  expect(autor.nome).toBe("Ursula K. Le Guin");
  expect(autor.livrosNoAcervo).toBe(0);
});

test("o ORCID é normalizado para o formato publicado", () => {
  const { useCase } = scenario();

  const autor = useCase.execute(novo({ orcid: "0000000218250097" }));

  expect(autor.orcid).toBe(ORCID_VALIDO);
});

test("ORCID com dígito verificador errado é recusado", () => {
  const { useCase } = scenario();

  expect(() => useCase.execute(novo({ orcid: "0000-0002-1825-0098" }))).toThrow(
    InvalidValue,
  );
});

test("o mesmo ORCID não entra duas vezes", () => {
  const { useCase } = scenario();

  useCase.execute(novo({ orcid: ORCID_VALIDO }));

  expect(() =>
    useCase.execute(novo({ nome: "Outro nome", orcid: ORCID_VALIDO })),
  ).toThrow(RuleConflict);
});

test("o mesmo nome não entra duas vezes, mesmo em caixa diferente", () => {
  const { useCase } = scenario();

  useCase.execute(novo({ orcid: ORCID_VALIDO }));

  expect(() =>
    useCase.execute(novo({ nome: "  ursula k. le guin ", orcid: OUTRO_ORCID })),
  ).toThrow(RuleConflict);
});

test("tipo fora do vocabulário do domínio é recusado", () => {
  const { useCase } = scenario();

  expect(() => useCase.execute(novo({ tipo: "sofá" }))).toThrow(InvalidValue);
});