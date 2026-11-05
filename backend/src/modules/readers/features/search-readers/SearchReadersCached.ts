import type { ReaderRepository } from "../../domain/ReaderRepository";
import type { RedisClient } from "bun";
import { redis } from "../../../../infrastructure/redis";
import { readCachedSearch, writeCachedSearch } from "../../infrastructure/searchCache";

export class SearchReadersCached {
  constructor(private readonly repository: ReaderRepository, private readonly client: RedisClient | null = redis) { this.client = client; }
  async execute(term?: string) { 
    const cached = await readCachedSearch(term, this.client);
    if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
    const readers = await this.repository.search(term);
    if (!cached) return { readers, cache: "BYPASS" };
    await writeCachedSearch(term, cached.generation, readers, this.client);
    return { readers, cache: "MISS" };
  }
  get(id: number) { return this.repository.get(id); }
}
