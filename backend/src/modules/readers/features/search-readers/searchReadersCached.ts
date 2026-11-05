import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { ReaderView } from "../../domain/Reader";
// import type { AuthorshipIntegration } from "../../domain/AuthorshipIntegration";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * A busca original continua igual, com 1 + N consultas (uma contagem de livros
 * por autor); é esse custo que o cache evita na segunda vez.
 */

export class SearchReadersCached {
  constructor(private readonly searchReaders: SearchReaders) { }

  async searchReadersCached(term: string,
    // integration: AuthorshipIntegration, 
    client: RedisClient | null = redis): Promise<{ readers: ReaderView[]; cache: CacheStatus }> {
    const cached = await readCachedSearch(term, client);
    if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
    const readers = await this.searchReaders.execute(term);
    if (!cached) return { readers, cache: "BYPASS" };
    await writeCachedSearch(term, cached.generation, readers, client);
    return { readers, cache: "MISS" };
  }
}