import { RedisClient, redis } from "bun";
import type { Reader } from "../../domain/Reader";
import { type CacheStatus, readCachedReaderSearch, writeCachedReaderSearch } from "../../infrastructure/searchCache";
import type { SearchReaders } from "./SearchReaders";

/**
 * Cache-aside em volta do caso de uso: SearchReaders e o repositório ficam
 * intactos, e o status HIT/MISS/BYPASS volta junto para a rota virar X-Cache.
 * O get(id) não passa por aqui, então segue sem cache.
 */
export async function searchReadersCached(search: SearchReaders, term: string | undefined, client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
    const q = term ?? "";
    const cached = await readCachedReaderSearch(q, client);
    if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
    const readers = await search.execute(q);
    if (!cached) return { readers, cache: "BYPASS" };
    await writeCachedReaderSearch(q, cached.generation, readers, client);
    return { readers, cache: "MISS" };
}