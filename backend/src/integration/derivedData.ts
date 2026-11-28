import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os dados derivados podem ter ficado para trás: o servidor esteve
 * parado enquanto o banco mudou, ou o seed escreveu direto nas tabelas.
 * Recalcula tudo a partir do Postgres, a fonte da verdade.
 */
export async function refreshDerivedData(): Promise<void> {
  const [{ indexed, removed }] = await Promise.all([
    reconcileBookIndex(catalogIntegration),
    invalidateAuthorSearch(),
  ]);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s), ${removed} removido(s)`);
}

/**
 * Enquanto o Redis esteve fora, as escritas não conseguiram invalidar o cache.
 * Na reconexão só o cache é invalidado: os vetores persistem no Postgres.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
