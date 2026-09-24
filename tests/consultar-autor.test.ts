import { expect, test } from "bun:test";
import { Autor } from "../src/modules/autoria/domain/Autor";
import type { Obra } from "../src/modules/autoria/domain/ConsultaDeAcervo";
import { ConsultarAutor } from "../src/modules/autoria/features/consultar-autor/ConsultarAutor";
import { NotFound } from "../src/shared/errors";
import { InMemoryAcervo, InMemoryAutorRepository } from "./doubles";

const EMMA = { titulo: "Emma", isbn: "9780141439587" };
const PERSUASAO = { titulo: "Persuasão", isbn: "9780141439761" };

function scenario(obras: Record<number, Obra[]>) {
  const autores = new InMemoryAutorRepository();

  autores.insert(Autor.cadastrar("Jane Austen", "literatura", null)); // id 1
  autores.insert(Autor.cadastrar("Octavia E. Butler", "literatura", null)); // id 2

  return new ConsultarAutor(autores, new InMemoryAcervo(obras));
}

test("devolve o autor com as obras que o Acervo informa", () => {
  const useCase = scenario({ 1: [EMMA, PERSUASAO] });

  const autor = useCase.execute(1);

  expect(autor.nome).toBe("Jane Austen");
  expect(autor.obras).toEqual([EMMA, PERSUASAO]);
});

test("autor sem livros no acervo vem com a lista vazia", () => {
  const useCase = scenario({ 1: [EMMA] });

  expect(useCase.execute(2).obras).toEqual([]);
});

test("autor que não existe devolve NotFound", () => {
  const useCase = scenario({});

  expect(() => useCase.execute(99)).toThrow(NotFound);
});

test("a contagem é a projeção; a lista é o que o Acervo diz agora", () => {
  const useCase = scenario({ 1: [EMMA, PERSUASAO] });

  const autor = useCase.execute(1);

  // nenhum evento chegou a este autor: a projeção diz 0, o Acervo diz 2
  expect(autor.livrosNoAcervo).toBe(0);
  expect(autor.obras).toHaveLength(2);
});
