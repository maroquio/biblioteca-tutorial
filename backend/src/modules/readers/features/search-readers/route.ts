import type { Hono } from "hono";
import { sql } from "../../../../infrastructure/postgres";
import { parsePositiveId } from "../../../../shared/http";
import { readerJson } from "../../infrastructure/json";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { SearchReaders } from "./SearchReaders";
import { searchReadersCached } from "./searchReadersCached";

export function registerRoutes(api: Hono): void {
  api.get("/leitores", async c => {
    const readers = await new SearchReaders(new PostgresReaderRepository(sql)).execute(c.req.query("q"));
    return c.json(readers.map(readerJson));
  });
  api.get("/leitores/:id", async c => {
    const reader = await new SearchReaders(new PostgresReaderRepository(sql)).get(parsePositiveId(c.req.param("id")));
    return c.json(readerJson(reader));
  });
  api.get("/leitores", async c => {
    const { readers, cache } = await searchReadersCached(c.req.query("q"), new PostgresReaderRepository(sql));
    c.header("X-Cache", cache);
    return c.json(readers.map(readerJson));
  });

}

