import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import { sql } from "../../../../infrastructure/postgres";
import type { Reader } from "../../domain/Reader";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * A busca original continua intacta na classe SearchReaders.
 */
export async function searchReadersCached(
  term = "",
  repository: ReaderRepository = new PostgresReaderRepository(sql),
  client: RedisClient | null = redis,
): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await new SearchReaders(repository).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
