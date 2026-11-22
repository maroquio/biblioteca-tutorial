import type { Hono } from "hono";
import { catalogIntegration } from "../../../../integration/catalogIntegration";
import { semanticBookJson } from "../../infrastructure/json";
import { searchBooksSemantically } from "./searchBooksSemantically";

/**
 * UC24: busca livros pelo significado do título e do autor.
 * Fica fora de /livros de propósito: a rota legada GET /livros/:q, registrada
 * antes, capturaria /livros/semantica como se "semantica" fosse um termo.
 */
export function registerRoutes(api: Hono): void {
  api.get("/busca-semantica/livros", async (c) =>
    c.json((await searchBooksSemantically(c.req.query("q") ?? "", catalogIntegration)).map(semanticBookJson)));
}
