import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores dos livros moram no Postgres (pgvector), e o servidor os reconcilia
 * na subida e depois de todo seed, sem depender do Redis: livros sem vetor, ou
 * com texto desatualizado, ganham vetor novo.
 */
export async function reconcileBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/**
 * Os dados derivados podem ter ficado para trás: o servidor esteve parado
 * enquanto o banco mudou, ou o seed escreveu direto nas tabelas. Recalcula tudo
 * a partir do Postgres, a fonte da verdade: o cache de autores (Redis) e os vetores.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await reconcileBookVectors();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache de buscas de autores. Por isso cada conexão (a
 * primeira e cada reconexão automática) o invalida. Os vetores dos livros não
 * dependem do Redis e ficam de fora: reindexar aqui não teria o que corrigir.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh: () => Promise<unknown> = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
