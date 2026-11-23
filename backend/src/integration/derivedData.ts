import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores da busca semântica moram no Postgres, ao lado dos livros, mas podem
 * ter ficado para trás: o seed escreveu direto nas tabelas, ou o Gemini estava fora
 * do ar quando um livro foi cadastrado. Reconciliar não depende do Redis.
 */
export async function reconcileBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Vetores dos livros: ${indexed} livro(s) indexado(s)`);
}

/**
 * Recalcula todos os dados derivados a partir do Postgres, a fonte da verdade: o
 * cache de autores, no Redis, e os vetores dos livros, no próprio Postgres.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await reconcileBookVectors();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache de autores. Por isso cada conexão (a primeira e
 * cada reconexão automática) o invalida. Os vetores dos livros ficam de fora:
 * eles moram no Postgres e continuaram em dia com o Redis fora do ar.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = () => invalidateAuthorSearch(client)): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
