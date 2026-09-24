import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerAvaliacao } from "./features/registrar-avaliacao/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
  registerAvaliacao(app, useCases);
}
