import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

export async function refreshBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/** O seed escreve diretamente no banco, sem disparar as atualizações das rotas. */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await refreshBookVectors();
}

/** Invalida o cache de autores quando o Redis conecta ou reconecta. */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
