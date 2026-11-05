import type { Hono } from "hono";
import { sql } from "../../../../infrastructure/postgres";
import { parsePositiveId } from "../../../../shared/http";
import { readerJson } from "../../infrastructure/json";
import { PostgresReaderRepository } from "../../infrastructure/PostgresReaderRepository";
import { SearchReadersCached } from "./SearchReadersCached";

/** UC10: busca leitores e consulta um leitor. */
export function registerRoutes(api: Hono): void {
  api.get("/leitores", async c => {
    const { readers, cache } = await new SearchReadersCached(new PostgresReaderRepository(sql)).execute(c.req.query("q"));
    c.header("X-Cache", cache);
    return c.json(readers.map(readerJson));
  });
  api.get("/leitores/:id", async c => {
    const reader = await new SearchReadersCached(new PostgresReaderRepository(sql)).get(parsePositiveId(c.req.param("id")));
    return c.json(readerJson(reader));
  });
}
