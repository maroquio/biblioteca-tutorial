import type { RedisClient } from "bun";
import { sql } from "../../../../infrastructure/postgres";
import { redis } from "../../../../infrastructure/redis";
import type { Reader } from "../../domain/Reader";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

/**
 * Cache-aside: procura no Redis; se não estiver lá, executa o caso de uso
 * original no Postgres e guarda o resultado na geração lida no início.
 */
export async function searchReadersCached(
  term = "",
  client: RedisClient | null = redis,
  repository: ReaderRepository = new PostgresReaderRepository(sql),
): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await new SearchReaders(repository).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
