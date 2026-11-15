import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Atualiza o cache de autores e reconcilia os vetores dos livros a partir do
 * Postgres, inclusive quando o seed escreveu diretamente nas tabelas.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  const { indexed, removed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s), ${removed} removido(s)`);
}

/**
 * Uma reconexão do Redis só precisa invalidar seu cache de autores. O índice
 * semântico está no Postgres e é reconciliado na inicialização e após o seed.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
