import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerSolicitarLivro } from "./features/solicitar-livro/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
  registerSolicitarLivro(app, useCases);
}
