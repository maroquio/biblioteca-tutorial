import type { Autor } from "../domain/Autor";
import { Livro, toIso } from "../domain/Livro";
import { AutorId } from "../domain/identifiers";
import { Isbn } from "../domain/Isbn";
import { LimiteDeLivros } from "../domain/LimiteDeLivros";
import { RuleConflict } from "../errors";
import {
  contarCatalogadosNoAno,
  contarNoAcervoDoAutor,
  findLivroByIsbn,
  findLivrosByAutorId,
  insertLivro,
  searchLivrosPorNomeDoAutor,
  searchLivrosPorTitulo,
} from "../repositories/livroRepository";
import { buscarAutor } from "./autorService";

export type LivroComAutor = { livro: Livro; autor: Autor };

export function cadastrarLivro(
  isbnBruto: string,
  titulo: string,
  autorIdBruto: number,
): LivroComAutor {
  const isbn = new Isbn(isbnBruto);
  const autorId = new AutorId(autorIdBruto);

  const autor = buscarAutor(autorId);

  LimiteDeLivros.verificar(autor.tipo, contarNoAcervoDoAutor(autorId));

  if (findLivroByIsbn(isbn)) {
    throw new RuleConflict("Livro já cadastrado");
  }

  const mesmoTitulo = findLivrosByAutorId(autorId).some((livro) =>
    livro.mesmoTituloQue(titulo),
  );

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
    contarCatalogadosNoAno(ano),
  );

  return { livro: insertLivro(livro), autor };
}

export function buscarLivros(q: string): LivroComAutor[] {
  if (Isbn.isValid(q)) {
    const porIsbn = findLivroByIsbn(new Isbn(q));

    if (porIsbn) return [comAutor(porIsbn)];
  }

  const porTitulo = searchLivrosPorTitulo(q);

  if (porTitulo.length > 0) return porTitulo.map(comAutor);

  return searchLivrosPorNomeDoAutor(q).map(comAutor);
}

function comAutor(livro: Livro): LivroComAutor {
  return { livro, autor: buscarAutor(livro.autorId) };
}
