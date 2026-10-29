import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerDevolverLivro } from "./features/devolver-livro/route";
import { register as registerEmprestarLivro } from "./features/emprestar-livro/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
  registerEmprestarLivro(app, useCases);
  registerDevolverLivro(app, useCases);
}
