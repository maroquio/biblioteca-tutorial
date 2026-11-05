import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { readCachedReaderSearch, writeCachedReaderSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

export async function searchReadersCached(term: string, repository: ReaderRepository, client: RedisClient | null = redis): Promise<{ readers: Awaited<ReturnType<ReaderRepository["search"]>>; cache: CacheStatus }> {
  const cached = await readCachedReaderSearch(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await new SearchReaders(repository).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedReaderSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
