
import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookVectors } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Reconcilia os vetores diretamente no PostgreSQL.
 * Não depende da conexão com o Redis.
 */
export async function refreshBookVectors(): Promise<void> {
  try {
    const { indexed } = await reconcileBookVectors(catalogIntegration);

    console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
  } catch (error) {
    console.warn(
      "Reconciliação do índice semântico indisponível:",
      (error as Error).message,
    );
  }
}

/**
 * Invalida o cache de autores quando o Redis conecta
 * ou restabelece a conexão.
 */
export function refreshAuthorSearchOnConnect(
  client: RedisClient | null = redis,
  refresh = () => invalidateAuthorSearch(client),
): void {
  if (!client) return;

  client.onconnect = () => {
    void refresh();
  };
}

/**
 * Atualiza os dados derivados após a execução do seed.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await refreshBookVectors();
}
