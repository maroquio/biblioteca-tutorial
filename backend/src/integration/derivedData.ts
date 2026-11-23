import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores da busca semântica (no Postgres, com pgvector) podem ter ficado para
 * trás: o seed escreveu direto em `livros`, ou o Gemini estava fora quando um
 * livro foi cadastrado. Não depende do Redis: roda na subida e depois de cada seed.
 */
export async function reconcileBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/** O que mora no Redis: só o cache da busca de autores, que a geração nova invalida. */
export async function refreshRedisData(): Promise<void> {
  await invalidateAuthorSearch();
}

/**
 * Recalcula tudo o que é derivado do Postgres, a fonte da verdade. O seed usa
 * este: ele escreve direto nas tabelas, sem passar pelos casos de uso.
 */
export async function refreshDerivedData(): Promise<void> {
  await refreshRedisData();
  await reconcileBookVectors();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache de autores. Por isso cada conexão (a primeira e
 * cada reconexão automática) invalida o cache. Os vetores não entram aqui: eles
 * estão no Postgres e não somem quando o Redis reinicia.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = refreshRedisData): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
