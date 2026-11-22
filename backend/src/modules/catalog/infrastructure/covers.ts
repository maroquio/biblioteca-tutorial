import { objectKey } from "../../../infrastructure/storage";

/**
 * UC25: a chave da capa no bucket. Fixa por livro: uma capa nova substitui a
 * anterior. "acervo" no primeiro trecho diz que o objeto pertence a este módulo.
 */
export function coverKey(bookId: number): string {
  return objectKey("acervo", "livros", bookId, "capa");
}
