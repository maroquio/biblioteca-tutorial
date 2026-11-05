import type { RedisClient } from "bun";
import { sql } from "../../../../infrastructure/postgres";
import { redis } from "../../../../infrastructure/redis";
import type { Reader } from "../../domain/Reader";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

export async function searchReadersCached(term = "", client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await new SearchReaders(new PostgresReaderRepository(sql)).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
