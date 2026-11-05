import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import type { Reader } from "../../domain/Reader";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";
import { SearchReaders } from "./SearchReaders";

/**
 * Cache-aside: procura no Redis; se não estiver lá, busca no Postgres e guarda.
 * O caso de uso SearchReaders continua igual e é só envolvido aqui, na fatia:
 * assim o status chega à rota e a consulta individual (get) fica sem cache.
 */
export async function searchReadersCached(term: string | undefined, repository: ReaderRepository, client: RedisClient | null = redis): Promise<{ readers: Reader[]; cache: CacheStatus }> {
  const cached = await readCachedSearch(term, client);
  if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
  const readers = await new SearchReaders(repository).execute(term);
  if (!cached) return { readers, cache: "BYPASS" };
  await writeCachedSearch(term, cached.generation, readers, client);
  return { readers, cache: "MISS" };
}
