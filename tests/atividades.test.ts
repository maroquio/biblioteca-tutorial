import { expect, test } from "bun:test";
import { CorrigirTitulo } from "../src/modules/acervo/features/corrigir-titulo/CorrigirTitulo";
import { RegistrarAvaliacao } from "../src/modules/avaliacoes/features/registrar-avaliacao/RegistrarAvaliacao";
import { Livro } from "../src/modules/acervo/domain/Livro";
import { Isbn } from "../src/modules/acervo/domain/Isbn";
import { NumeroRegistro } from "../src/modules/acervo/domain/NumeroRegistro";
import { AutorId, AvaliacaoId, LivroId } from "../src/shared/identifiers";
import type { LivroRepository } from "../src/modules/acervo/domain/LivroRepository";
import type { Avaliacao } from "../src/modules/avaliacoes/domain/Avaliacao";
import type { AvaliacaoRepository } from "../src/modules/avaliacoes/domain/AvaliacaoRepository";
import type { ConsultaDeAcervo } from "../src/modules/avaliacoes/domain/ConsultaDeAcervo";

class LivroRepo implements LivroRepository {
  constructor(private items: Livro[]) {}
  contarNoAcervoDoAutor(id: AutorId) { return this.items.filter((l) => l.autorId.equals(id)).length; }
  contarCatalogadosNoAno(ano: string) { return this.items.filter((l) => l.dataCatalogacao.startsWith(ano)).length; }
  insert(livro: Livro) { this.items.push(livro); return livro; }
  findByIsbn(isbn: Isbn) { return this.items.find((l) => l.isbn.equals(isbn)) ?? null; }
  findByAutorId(id: AutorId) { return this.items.filter((l) => l.autorId.equals(id)); }
  searchByTitulo(termo: string) { return this.items.filter((l) => l.titulo.includes(termo)); }
  findByAutorIds(ids: AutorId[]) { return this.items.filter((l) => ids.some((id) => l.autorId.equals(id))); }
  findById(id: LivroId) { return this.items.find((l) => l.id?.equals(id)) ?? null; }
  updateTitulo(livro: Livro) { this.items = this.items.map((atual) => atual.id?.equals(livro.id!) ? livro : atual); }
}

function livro(id: number, titulo: string, autorId = 1) {
  return new Livro(new LivroId(id), new NumeroRegistro(`2026-${String(id).padStart(6, "0")}`), new Isbn("9780141439518"), titulo, new AutorId(autorId), "2026-01-01");
}

test("Atividade 5: corrige o título sem alterar a identidade do livro", () => {
  const repo = new LivroRepo([livro(1, "Livro antigo")]);
  const result = new CorrigirTitulo(repo).execute({ id: 1, titulo: "Livro novo" });
  expect(result).toEqual({ id: 1, isbn: "9780141439518", titulo: "Livro novo" });
  expect(repo.findById(new LivroId(1))?.numeroRegistro.value).toBe("2026-000001");
});

class AvaliacoesRepo implements AvaliacaoRepository {
  items: Avaliacao[] = [];
  findByMatriculaELivro(matricula: string, numeroRegistro: string) { return this.items.find((a) => a.matricula === matricula && a.numeroRegistro === numeroRegistro) ?? null; }
  insert(avaliacao: Avaliacao) { const salvo = avaliacao.withId(new AvaliacaoId(this.items.length + 1)); this.items.push(salvo); return salvo; }
}

test("Atividade 6: registra nota válida e impede avaliação duplicada", () => {
  const repo = new AvaliacoesRepo();
  const acervo: ConsultaDeAcervo = { existeNumeroRegistro: () => true };
  const useCase = new RegistrarAvaliacao(repo, acervo);
  expect(useCase.execute({ numeroRegistro: "2026-000001", matricula: "A-1", nota: 5, comentario: null }).nota).toBe(5);
  expect(() => useCase.execute({ numeroRegistro: "2026-000001", matricula: "A-1", nota: 4, comentario: null })).toThrow("Leitor já avaliou este livro");
});
