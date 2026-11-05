import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { Reader } from "../../domain/Reader";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import type { SearchReaders } from "./SearchReaders";

export async function searchReaderByIdCached(id: number, search: SearchReaders, client: RedisClient | null = redis): Promise<{ reader: Reader; cache: CacheStatus }> {
    const cached = await readCachedSearch(String(id), client);
    if (cached?.readers && cached?.readers.length > 0) {
        if (!cached.readers[0]) throw new Error(`Reader with id ${id} not found`);
        return { reader: cached.readers[0], cache: "HIT" };

    }

    const reader = await search.get(id);

    if (!cached) return { reader, cache: "BYPASS" };
    await writeCachedSearch(String(id), cached.generation, [reader], client);

    return { reader, cache: "MISS" };
}
