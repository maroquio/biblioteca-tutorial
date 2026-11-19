import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookVectors } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores dos livros moram no Postgres, junto com os livros: o seed escreve
 * direto nas tabelas e o Gemini pode ter ficado fora do ar numa escrita. Indexa
 * o que falta e refaz o que ficou com texto desatualizado. Não depende do Redis.
 */
export async function reconcileSearchVectors(): Promise<void> {
  const { indexed } = await reconcileBookVectors(catalogIntegration);
  console.log(`Busca semântica: ${indexed} livro(s) indexado(s)`);
}

/** Depois do seed, o cache do Redis e os vetores do Postgres podem ter ficado para trás. */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await reconcileSearchVectors();
}

/** Só o cache de autores é do Redis. */
async function refreshRedisCache(): Promise<void> {
  await invalidateAuthorSearch();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache. Por isso cada conexão (a primeira e cada
 * reconexão automática) o invalida. Os vetores não precisam disso: não estão no Redis.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = refreshRedisCache): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
