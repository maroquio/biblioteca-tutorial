import type { Autor } from "../domain/Autor";
import type { AutorRepository } from "../domain/AutorRepository";
import { Livro, toIso } from "../domain/Livro";
import type { LivroRepository } from "../domain/LivroRepository";
import { AutorId } from "../domain/identifiers";
import { Isbn } from "../domain/Isbn";
import { LimiteDeLivros } from "../domain/LimiteDeLivros";
import { RuleConflict } from "../errors";
import { buscarAutor } from "./autorService";

export type LivroComAutor = { livro: Livro; autor: Autor };

export function cadastrarLivro(
  livros: LivroRepository,
  autores: AutorRepository,
  isbnBruto: string,
  titulo: string,
  autorIdBruto: number,
): LivroComAutor {
  const isbn = new Isbn(isbnBruto);
  const autorId = new AutorId(autorIdBruto);

  const autor = buscarAutor(autores, autorId);

  LimiteDeLivros.verificar(autor.tipo, livros.contarNoAcervoDoAutor(autorId));

  if (livros.findByIsbn(isbn)) {
    throw new RuleConflict("Livro já cadastrado");
  }

  const mesmoTitulo = livros
    .findByAutorId(autorId)
    .some((livro) => livro.mesmoTituloQue(titulo));

  if (mesmoTitulo) {
    throw new RuleConflict("Este autor já tem um livro com este título");
  }

  const hoje = new Date();
  const ano = toIso(hoje).slice(0, 4);

  const livro = Livro.catalogar(
    isbn,
    titulo,
    autorId,
    hoje,
    livros.contarCatalogadosNoAno(ano),
  );

  return { livro: livros.insert(livro), autor };
}

export function buscarLivros(
  livros: LivroRepository,
  autores: AutorRepository,
  q: string,
): LivroComAutor[] {
  const comAutor = (livro: Livro): LivroComAutor => ({
    livro,
    autor: buscarAutor(autores, livro.autorId),
  });

  if (Isbn.isValid(q)) {
    const porIsbn = livros.findByIsbn(new Isbn(q));

    if (porIsbn) return [comAutor(porIsbn)];
  }

  const porTitulo = livros.searchByTitulo(q);

  if (porTitulo.length > 0) return porTitulo.map(comAutor);

  return livros.searchByNomeDoAutor(q).map(comAutor);
}
