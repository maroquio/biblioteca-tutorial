import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { Reader } from "../../domain/Reader";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

export async function searchReadersCached(term: string | undefined, repository: ReaderRepository, client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const query = term ?? "";
  const cached = await readCachedSearch(query, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await new SearchReaders(repository).execute(query);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(query, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
