import { getBodyAsObject, getFieldAsPositiveInt, getFieldAsText } from "../../shared/validation";

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
