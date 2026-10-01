import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerSolicitacao } from "./features/registrar-solicitacao/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
  registerSolicitacao(app, useCases);
}