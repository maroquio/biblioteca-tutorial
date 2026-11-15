import type { RedisClient } from "bun";
import type { Reader } from "../../domain/Reader";
import { SearchReaders } from "./SearchReaders";
import { sql } from "../../../../infrastructure/postgres";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { redis } from "../../../../infrastructure/redis";

/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * A busca original continua igual, com 1 + N consultas (uma contagem de livros
 * por autor); é esse custo que o cache evita na segunda vez.
 */
export async function searchReadersCached(term: string | undefined, client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
    const key = term ?? "";
    const cached = await readCachedSearch(key, client);
    if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
    const readers = await new SearchReaders(new PostgresReaderRepository(sql)).execute(key);
    if (!cached) return { readers, cache: "BYPASS" };
    await writeCachedSearch(key, cached.generation, readers, client);
    return { readers, cache: "MISS" };
}