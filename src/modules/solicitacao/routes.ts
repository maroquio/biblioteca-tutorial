import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerRegistrarSolicitacao } from "./features/nova-solicitacao/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
  registerRegistrarSolicitacao(app, useCases);
}
