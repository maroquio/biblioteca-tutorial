import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerCadastrarAvaliacaoRoute } from "./features/cadastrar-avaliacao/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
  registerCadastrarAvaliacaoRoute(app, useCases);
}
