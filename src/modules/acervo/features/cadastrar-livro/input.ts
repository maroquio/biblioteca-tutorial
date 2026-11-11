import { getBodyAsObject, getFieldAsPositiveInt, getFieldAsText } from "../../../../shared/validation";
import type { Livro } from "../../domain/Livro";

export type NovoLivro = {
  isbn: string;
  titulo: string;
  autorId: number;
};


export function parseNovoLivro(body: unknown): NovoLivro {
  const data = getBodyAsObject(body);

  return {
    isbn: getFieldAsText(data, "isbn"),
    titulo: getFieldAsText(data, "titulo"),
    autorId: getFieldAsPositiveInt(data, "autorId"),
  };
}



export type TituloCorrigidoJson = {
  id: number;
  isbn: string;
  titulo: string;
};

export function tituloCorrigidoToJson(livro: Livro): TituloCorrigidoJson {
  return {
    id: livro.id!.value,
    isbn: livro.isbn.value,
    titulo: livro.titulo,
  };
}
