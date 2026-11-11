import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

export async function refreshDerivedData(): Promise<void> {
  const [, { indexed, removed }] = await Promise.all([
    invalidateAuthorSearch(),
    reconcileBookIndex(catalogIntegration),
  ]);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s), ${removed} removido(s)`);
}

export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = () => invalidateAuthorSearch(client)): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
