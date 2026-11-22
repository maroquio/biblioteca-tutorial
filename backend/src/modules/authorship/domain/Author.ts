import { InvalidInput } from "../../../shared/errors";
import { getBodyAsObject, getFieldAsText } from "../../../shared/validation";

export type AuthorType = "literatura" | "didatico";

export type AuthorInput = { name: string; type: AuthorType };

export type AuthorView = {
  id: number; name: string; type: AuthorType; bookCount: number;
  /**
   * UC26: quando a foto mudou, em milissegundos; null se o autor não tem foto.
   * Um número, e não Date: a busca de autores volta do cache do Redis como JSON,
   * e um Date viraria texto no caminho.
   */
  photoVersion: number | null;
};

export function parseAuthorInput(body: unknown): AuthorInput {
  const data = getBodyAsObject(body);
  const type = getFieldAsText(data, "tipo");
  if (type !== "literatura" && type !== "didatico") throw new InvalidInput("Tipo deve ser literatura ou didatico");
  return { name: getFieldAsText(data, "nome"), type };
}
