import { expect, test } from "bun:test";
import { CadastrarLivro } from "../src/modules/acervo/features/cadastrar-livro/CadastrarLivro";
import { CorrigirIsbn } from "../src/modules/acervo/features/corrigir-isbn/CorrigirIsbn";
import {
  FakeEventPublisher,
  InMemoryAutoria,
  InMemoryLivroRepository,
} from "./doubles";

const AUSTEN = 4;
const EVANS = 1;

function setup() {
  const livros = new InMemoryLivroRepository();
  const autoria = new InMemoryAutoria({
    [AUSTEN]: { nome: "Jane Austen", tiragem: "curta", livrosNoAcervo: 0 },
    [EVANS]: { nome: "Eric Evans", tiragem: "ampla", livrosNoAcervo: 0 },
  });
  const events = new FakeEventPublisher();
  const cadastrar = new CadastrarLivro(livros, autoria, () => new Date("2026-03-10"), events);
  const corrigir = new CorrigirIsbn(livros);

  return { livros, cadastrar, corrigir, events };
}

test("corrige o ISBN com sucesso preservando id e numeroRegistro", () => {
  const { cadastrar, corrigir, livros, events } = setup();

  const livroCadastrado = cadastrar.execute({
    isbn: "9780141439518",
    titulo: "Livro de teste 5B A",
    autorId: AUSTEN,
  });

  const eventosAntes = events.published.length;

  const resultado = corrigir.execute({
    id: livroCadastrado.id,
    isbn: "978-0-14-143958-7",
  });

  expect(resultado).toEqual({
    id: livroCadastrado.id,
    numeroRegistro: livroCadastrado.numeroRegistro,
    isbn: "9780141439587",
  });

  // Não emite LivroCatalogado
  expect(events.published.length).toBe(eventosAntes);

  // Livro no repositório foi atualizado
  const livroAtualizado = livros.findById(new (livros as any).items[0].id.constructor(livroCadastrado.id));
  expect(livroAtualizado?.isbn.value).toBe("9780141439587");
  expect(livroAtualizado?.titulo).toBe("Livro de teste 5B A");
  expect(livroAtualizado?.autorId.value).toBe(AUSTEN);
  expect(livroAtualizado?.dataCatalogacao).toBe(livroCadastrado.dataCatalogacao);
});

test("permite enviar o ISBN do próprio livro", () => {
  const { cadastrar, corrigir } = setup();

  const livro = cadastrar.execute({
    isbn: "9780141439518",
    titulo: "Livro de teste 5B A",
    autorId: AUSTEN,
  });

  const resultado = corrigir.execute({
    id: livro.id,
    isbn: "9780141439518",
  });

  expect(resultado).toEqual({
    id: livro.id,
    numeroRegistro: livro.numeroRegistro,
    isbn: "9780141439518",
  });
});

test("recusa livro inexistente com erro 404 (NotFound)", () => {
  const { corrigir } = setup();

  expect(() =>
    corrigir.execute({
      id: 999999,
      isbn: "9780141439587",
    }),
  ).toThrow("Livro não encontrado");
});

test("recusa ISBN já usado por outro livro (RuleConflict)", () => {
  const { cadastrar, corrigir } = setup();

  const livroA = cadastrar.execute({
    isbn: "9780141439518",
    titulo: "Livro de teste 5B A",
    autorId: AUSTEN,
  });

  cadastrar.execute({
    isbn: "9780141439662",
    titulo: "Livro de teste 5B B",
    autorId: EVANS,
  });

  expect(() =>
    corrigir.execute({
      id: livroA.id,
      isbn: "978-0-14-143966-2",
    }),
  ).toThrow("Outro livro já utiliza este ISBN");
});

test("recusa ISBN inválido (dígito verificador incorreto)", () => {
  const { cadastrar, corrigir } = setup();

  const livroA = cadastrar.execute({
    isbn: "9780141439518",
    titulo: "Livro de teste 5B A",
    autorId: AUSTEN,
  });

  expect(() =>
    corrigir.execute({
      id: livroA.id,
      isbn: "9780141439588",
    }),
  ).toThrow();
});
