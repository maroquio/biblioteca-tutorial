import { RuleConflict } from "../errors";
import {
  contarCatalogadosNoAno,
  contarNoAcervoDoAutor,
  findLivroByIsbn,
  findLivrosByAutorId,
  insertLivro,
  searchLivrosPorNomeDoAutor,
  searchLivrosPorTitulo,
  type LivroRow,
} from "../repositories/livroRepository";
import { buscarAutor } from "./autorService";

export function cadastrarLivro(
  isbnBruto: string,
  titulo: string,
  autorId: number,
): LivroRow & { autor: string } {
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

  const mesmoTitulo = findLivrosByAutorId(autorId).some(
    (livro) => livro.titulo.toLowerCase() === titulo.toLowerCase(),
  );

  if (mesmoTitulo) {
    throw new RuleConflict("Este autor já tem um livro com este título");
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const ano = hoje.slice(0, 4);

  const sequencial = contarCatalogadosNoAno(ano) + 1;
  const numeroRegistro = `${ano}-${String(sequencial).padStart(6, "0")}`;

  const livro = insertLivro(numeroRegistro, isbn, titulo, autorId, hoje);

  return { ...livro, autor: autor.nome };
}

export function buscarLivros(q: string): LivroRow[] {
  const porIsbn = findLivroByIsbn(q);

  if (porIsbn) return [porIsbn];

  const porTitulo = searchLivrosPorTitulo(q);

  if (porTitulo.length > 0) return porTitulo;

  return searchLivrosPorNomeDoAutor(q);
}
