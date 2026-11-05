import type { Hono } from "hono";
import { sql } from "../../../../infrastructure/postgres";
import { parsePositiveId } from "../../../../shared/http";
import { readerJson } from "../../infrastructure/json";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { SearchReaders } from "./SearchReaders";
import { searchReadersCached } from "./searchReadersCached";
import { searchReaderByIdCached } from "./searchReaderByIdCached";


export function registerRoutes(api: Hono): void {
    api.get("/leitores", async c => {
        const { readers, cache } = await searchReadersCached(c.req.query("q"), new SearchReaders(new PostgresReaderRepository(sql)));
        c.header("X-Cache", cache);
        return c.json(readers.map(readerJson));
    });

    api.get("/leitores/:id", async c => {
        const { reader, cache } = await searchReaderByIdCached(parsePositiveId(c.req.param("id")), new SearchReaders(new PostgresReaderRepository(sql)));
        c.header("X-Cache", cache);
        return c.json(readerJson(reader));
    });
}
