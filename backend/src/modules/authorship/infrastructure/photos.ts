import { objectKey } from "../../../infrastructure/storage";

/** UC26: enviar outra foto do mesmo autor substitui o objeto nesta chave. */
export function photoKey(authorId: number): string {
  return objectKey("autoria", "autores", authorId, "foto");
}
