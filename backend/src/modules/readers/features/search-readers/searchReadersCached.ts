import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { Reader } from "../../domain/Reader";
import { readCachedReader, writeCachedReader, type CacheStatus } from "../../infrastructure/readerCache";
import { SearchReaders } from "./SearchReaders";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { sql } from "../../../../infrastructure/postgres";

/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * A busca original continua igual, com 1 + N consultas (uma contagem de livros
 * por autor); é esse custo que o cache evita na segunda vez.
 */
export async function searchReadersCached(term: string, client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const cached = await readCachedReader(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };

  // term is expected to match c.req.query("q")
  const readers = await new SearchReaders(new PostgresReaderRepository(sql)).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedReader(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}