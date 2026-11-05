import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { ReaderView } from "../../domain/Reader";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./searchReaders";

/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * O caso de uso SearchReaders continua igual; o cache só o envolve.
 */
export async function searchReadersCached(term: string, repository: ReaderRepository, client: RedisClient | null = redis): Promise<{ readers: ReaderView[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await new SearchReaders(repository).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
