import type { Hono } from "hono";
import { catalogIntegration } from "../../../../integration/catalogIntegration";
import { bookJson } from "../../infrastructure/json";
import { listBooks } from "./listBooks";

export function registerRoutes(api: Hono): void {
  api.get("/lista-livros", async (c) => c.json((await listBooks(catalogIntegration)).map(bookJson)));
}
