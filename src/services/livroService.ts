import type { Autor } from "../domain/Autor";
import type { AutorRepository } from "../domain/AutorRepository";
import type { Livro } from "../domain/Livro";
import type { LivroRepository } from "../domain/LivroRepository";
import { Isbn } from "../domain/Isbn";
import { buscarAutor } from "./autorService";

export type LivroComAutor = { livro: Livro; autor: Autor };

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
