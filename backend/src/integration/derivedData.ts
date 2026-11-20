import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os dados derivados podem ter ficado para trás: o servidor esteve parado
 * enquanto o banco mudou, ou o seed escreveu direto nas tabelas.
 * Reconcilia o índice semântico no Postgres e invalida o cache no Redis.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  const { indexed, removed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s), ${removed} removido(s)`);
}

/**
 * Quando o Redis reconecta, apenas o cache de buscas de autores precisa ser
 * recalculado/invalidado, pois os vetores da busca semântica residem de forma
 * durável no PostgreSQL via pgvector e não dependem do ciclo de vida do Redis.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
