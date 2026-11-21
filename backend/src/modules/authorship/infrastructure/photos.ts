import { objectKey } from "../../../infrastructure/storage";

/**
 * UC26: a chave da foto no bucket. Fixa por autor: uma foto nova substitui a
 * anterior. "autoria" no primeiro trecho diz que o objeto pertence a este módulo.
 * Fica em infrastructure porque duas fatias usam: manage-author-photo e delete-author.
 */
export function photoKey(authorId: number): string {
  return objectKey("autoria", "autores", authorId, "foto");
}
