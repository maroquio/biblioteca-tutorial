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
  baixa: { motivo: string; em: string } | null;
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
    baixa:
      livro.baixa === null
        ? null
        : { motivo: livro.baixa.motivo, em: livro.baixa.em },
  };
}