import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerNovaSolicitacao } from "./features/registrar-solicitacao/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
  registerNovaSolicitacao(app, useCases);
}
