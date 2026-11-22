import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/** Reconcilia os vetores persistidos no Postgres, sem depender do Redis. */
export async function refreshBookVectors(): Promise<void> {
  const { indexed, removed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s), ${removed} removido(s)`);
}

/**
 * O seed escreve direto nas tabelas: atualiza tanto o cache derivado no Redis
 * quanto os vetores derivados no Postgres.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await refreshBookVectors();
}

/** A reconexão do Redis só precisa invalidar o cache de autores que vive nele. */
export function refreshRedisDerivedDataOnConnect(
  client: RedisClient | null = redis,
  refresh = invalidateAuthorSearch,
): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
