import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

export async function refreshBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/** O seed escreve direto nas tabelas e pode afetar tanto o cache quanto os vetores. */
export async function refreshDerivedData(): Promise<void> {
  await Promise.all([invalidateAuthorSearch(), refreshBookVectors()]);
}

/** As escritas feitas durante uma queda do Redis podem ter deixado o cache desatualizado. */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = () => invalidateAuthorSearch(client)): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
