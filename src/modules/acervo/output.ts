import type { AutorConhecido } from "./domain/ConsultaDeAutoria";
import type { Livro } from "./domain/Livro";

export type LivroJson = {
  id: number;
  numeroRegistro: string;
  isbn: string;
  titulo: string;
  autor: string;
  livrosDoAutor: number;
  dataCatalogacao: string;
};

export type TituloCorrigidoJson = {
  id: number;
  isbn: string;
  titulo: string;
};

export function tituloCorrigidoToJson(livro: Livro): TituloCorrigidoJson {      // 5 edição novo...
  return {
    id: livro.id!.value,
    isbn: livro.isbn.value,
    titulo: livro.titulo,
  };
}

export function livroToJson(livro: Livro, autor: AutorConhecido): LivroJson {
  return {
    id: livro.id!.value,
    numeroRegistro: livro.numeroRegistro.value,
    isbn: livro.isbn.value,
    titulo: livro.titulo,
    autor: autor.nome,
    livrosDoAutor: autor.livrosNoAcervo,
    dataCatalogacao: livro.dataCatalogacao,
  };
}
export type IsbnCorrigidoJson = {
  id: number;
  numeroRegistro: string;
  isbn: string;
};

export function isbnCorrigidoToJson(livro: Livro): IsbnCorrigidoJson {
  return {
    id: livro.id!.value,
    numeroRegistro: livro.numeroRegistro.value,
    isbn: livro.isbn.value,
  };
}
