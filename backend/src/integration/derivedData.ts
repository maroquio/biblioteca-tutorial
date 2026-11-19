import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores dos livros vivem no Postgres, junto com os livros. Livros sem vetor
 * (o seed escreve direto nas tabelas; o Gemini estava fora do ar) ganham vetor,
 * e textos desatualizados são refeitos. Não depende do Redis.
 */
export async function refreshBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/**
 * O seed escreveu direto nas tabelas, sem passar pelos casos de uso: o cache de
 * autores (Redis) e os vetores (Postgres) podem ter ficado para trás.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await refreshBookVectors();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache de autores. Por isso cada conexão (a primeira e
 * cada reconexão automática) o invalida. Os vetores não entram aqui: eles não
 * moram no Redis e não ficam para trás quando ele cai.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh: () => Promise<void> = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}