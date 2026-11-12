import type { Reader } from "../..";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { readCachedSearch, writeCachedSearch, type CacheStatus } from "../../infrastructure/searchCache";


export class SearchReadersCached {
  constructor(private readonly repository: ReaderRepository) {}
  async execute(term: string, client?: any): Promise<Reader[]> {
    const cached = await readCachedSearch(term, client);
    if (cached?.readers) return { readers: cached.readers, cache: "HIT" };
    const readers = await this.repository.search(term);
    await writeCachedSearch(term, cached.generation, readers);
    return readers;
  }
  get(id: number) { return this.repository.get(id); }
}
