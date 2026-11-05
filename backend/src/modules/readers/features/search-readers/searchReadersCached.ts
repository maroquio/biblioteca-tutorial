import { redis } from "../../../../infrastructure/redis";
import type { AuthorView } from "../../../authorship/domain/Author";
import { type CacheStatus, readCachedSearch, writeCachedSearch } from "../../../authorship/infrastructure/searchCache";
import type { ReadersIntegration } from "../../domain/ReadersIntegration";


/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * A busca original continua igual, com 1 + N consultas (uma contagem de livros
 * por autor); é esse custo que o cache evita na segunda vez.
 */
export async function searchReadersCached(term: string, integration: ReadersIntegration, client: RedisClient | null = redis): Promise<{ authors: ReadersView[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.readers) return { authors: cached.readers, cache: "HIT" };
  const readers = await SearchReaders(term, integration);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}