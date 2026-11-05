import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import {
  readCachedReaderSearch,
  writeCachedReaderSearch,
  type ReaderCacheStatus,
} from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

export async function searchReadersCached(
  term: string | undefined,
  repository: ReaderRepository,
  client: RedisClient | null = redis,
): Promise<{ readers: Awaited<ReturnType<SearchReaders["execute"]>>; cache: ReaderCacheStatus }> {
  const query = term ?? "";
  const cached = await readCachedReaderSearch(query, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };

  const readers = await new SearchReaders(repository).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };

  await writeCachedReaderSearch(query, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
