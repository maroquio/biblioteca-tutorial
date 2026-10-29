import type { Hono } from "hono";
import { authorshipIntegration } from "../../../../integration/authorshipIntegration";
import { parseId } from "../../../../shared/validation";
import { authorJson } from "../../infrastructure/json";
import { getAuthor } from "./getAuthor";
import { searchAuthorsCached } from "./searchAuthorsCached";

/** UC06: busca autores por nome ou identificador, com cache no Redis. */
export function registerRoutes(api: Hono): void {
  api.get("/autores", async (c) => {
    const { authors, cache } = await searchAuthorsCached(c.req.query("q") ?? "", authorshipIntegration);
    // HIT, MISS ou BYPASS (sem Redis): dá para ver o cache funcionando no DevTools
    c.header("X-Cache", cache);
    return c.json(authors.map(authorJson));
  });
  api.get("/autores/:id", async (c) => c.json(authorJson(await getAuthor(parseId(c.req.param("id")), authorshipIntegration))));
}