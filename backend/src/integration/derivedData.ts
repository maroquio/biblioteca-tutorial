import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os dados derivados podem ter ficado para trás: o servidor esteve parado
 * enquanto o banco mudou, ou o seed escreveu direto nas tabelas. Recalcula tudo
 * a partir das tabelas, a fonte da verdade.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await reconcileBookVectors();
}

/** Os vetores da busca semântica moram no Postgres: reconciliá-los não depende do Redis. */
export async function reconcileBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Busca semântica: ${indexed} livro(s) indexado(s)`);
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache de autores. Por isso cada conexão (a primeira e
 * cada reconexão automática) invalida esse cache. Os vetores não estão no Redis
 * e não precisam de nada quando ele volta.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh: () => Promise<void> = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
