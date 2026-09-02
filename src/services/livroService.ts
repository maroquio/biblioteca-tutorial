import type { Livro } from "../domain/Livro";
import { RuleConflict } from "../errors";
import type { AutorRow } from "../repositories/autorRepository";
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

export type LivroComAutor = { livro: Livro; autor: AutorRow };

export function cadastrarLivro(
  isbnBruto: string,
  titulo: string,
  autorId: number,
): LivroComAutor {
  const isbn = isbnBruto.replace(/[^0-9]/g, "");

  const autor = buscarAutor(autorId);

  const noAcervo = contarNoAcervoDoAutor(autorId);
  const limite = autor.tipo === "didatico" ? 10 : 5;

  if (noAcervo >= limite) {
    throw new RuleConflict(`O autor já tem ${limite} livros no acervo`);
  }

  if (findLivroByIsbn(isbn)) {
    throw new RuleConflict("Livro já cadastrado");
  }

  const mesmoTitulo = findLivrosByAutorId(autorId).some((livro) =>
    livro.mesmoTituloQue(titulo),
  );

  if (mesmoTitulo) {
    throw new RuleConflict("Este autor já tem um livro com este título");
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const ano = hoje.slice(0, 4);

  const sequencial = contarCatalogadosNoAno(ano) + 1;
  const numeroRegistro = `${ano}-${String(sequencial).padStart(6, "0")}`;

  return { livro: insertLivro(numeroRegistro, isbn, titulo, autorId, hoje), autor };
}

export function buscarLivros(q: string): LivroComAutor[] {
  const porIsbn = findLivroByIsbn(q);

  if (porIsbn) return [comAutor(porIsbn)];

  const porTitulo = searchLivrosPorTitulo(q);

  if (porTitulo.length > 0) return porTitulo.map(comAutor);

  return searchLivrosPorNomeDoAutor(q).map(comAutor);
}

function comAutor(livro: Livro): LivroComAutor {
  return { livro, autor: buscarAutor(livro.autorId) };
}
