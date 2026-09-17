import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { register as registerCadastrarAutor } from "./features/cadastrar-autor/route";

export function registerRoutes(app: Hono, useCases: UseCases): void {
    registerCadastrarAutor(app, useCases);
}