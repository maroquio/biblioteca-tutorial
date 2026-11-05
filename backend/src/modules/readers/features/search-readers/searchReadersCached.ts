import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { Reader } from "../../domain/Reader";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import type { SearchReaders } from "./SearchReaders";

/**
 * Cache-aside em volta do caso de uso, e não dentro do repositório: assim o
 * status chega à rota e o get(id) continua indo direto ao Postgres.
 */
export async function searchReadersCached(term: string | undefined, search: SearchReaders, client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await search.execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
