import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import { sql } from "../../../../infrastructure/postgres";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import type { Reader } from "../../domain/Reader";

/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * A busca original continua igual, com 1 + N consultas (uma contagem de livros
 * por autor); é esse custo que o cache evita na segunda vez.
 */
export async function searchReadersCached(term: string, client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.reader) return { readers: cached.reader, cache: "HIT" };
  const readers = await new SearchReaders(new PostgresReaderRepository(sql)).execute(term);  
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}





