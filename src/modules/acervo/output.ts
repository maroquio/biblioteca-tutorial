import type { Avaliacao } from "./domain/Avaliacao";
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

export type AvaliacaoJson = {
  id: number;
  numeroRegistro: string;
  matricula: string;
  nota: number;
  comentario: string | null;
};

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

export function avaliacaoToJson(avaliacao: Avaliacao): AvaliacaoJson {
  return {
    id: avaliacao.id!.value,
    numeroRegistro: avaliacao.numeroRegistro,
    matricula: avaliacao.matricula,
    nota: avaliacao.nota,
    comentario: avaliacao.comentario,
  };
}