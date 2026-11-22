import { objectKey } from "../../../infrastructure/storage";

/**
 * UC26: a chave da foto no bucket. Fixa por autor: uma foto nova substitui a
 * anterior. "autoria" no primeiro trecho diz que o objeto pertence a este módulo,
 * o mesmo dono das chaves do cache da busca de autores.
 *
 * Mora em infrastructure, e não numa fatia, porque duas fatias precisam dela:
 * manage-author-photo e delete-author. Uma fatia não importa outra.
 */
export function photoKey(authorId: number): string {
  return objectKey("autoria", "autores", authorId, "foto");
}
