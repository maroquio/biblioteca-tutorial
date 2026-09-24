import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerRegistrarAvaliacao } from "./features/registrar-avaliacao/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
    registerRegistrarAvaliacao(app, useCases);
}