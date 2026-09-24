import { getBodyAsObject, getFieldAsPositiveInt, getFieldAsText } from "../../../../shared/validation";
import { Livro } from "../domain/Livro";

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

export type CorrecaoDeTitulo = {
  id: number;
  titulo: string;
};

export function parseCorrecaoDeTitulo(
  params: { id?: string },
  body: unknown,
): CorrecaoDeTitulo {
  const data = getBodyAsObject(body);
  return {
    id: getFieldAsPositiveInt(params, "id"),
    titulo: getFieldAsText(data, "titulo"),
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