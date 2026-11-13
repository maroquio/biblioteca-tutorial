import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores da busca semântica podem ter ficado para trás: o seed escreveu
 * direto em livros, ou o Gemini esteve fora do ar numa escrita. Eles moram no
 * Postgres, então reconciliar não depende do Redis.
 */
export async function reconcileBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/**
 * Depois do seed, tudo o que é derivado do Postgres é recalculado: o cache de
 * autores no Redis e os vetores dos livros.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await reconcileBookVectors();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache de autores. Por isso cada conexão (a primeira e
 * cada reconexão automática) invalida o cache. Os vetores não estão no Redis:
 * uma reconexão não tem o que reindexar.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh: () => Promise<void> = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
