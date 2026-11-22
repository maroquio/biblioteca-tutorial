import { NotImplemented } from "../../../shared/errors";
import { objectKey } from "../../../infrastructure/storage";

/**
 * UC26: a chave da foto no bucket. Fixa por autor: uma foto nova substitui a
 * anterior.
 *
 * TODO (atividade): monte a chave com objectKey(...), de infrastructure/storage.
 * O primeiro trecho diz o módulo dono do objeto, como em redisKey(...). Compare
 * com coverKey, em modules/catalog/infrastructure/covers.ts, e rode
 * `bun run check-boundaries` para conferir o dono.
 */
export function photoKey(authorId: number): string {
  return objectKey("autoria", "autores", authorId, "foto");
}
