import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseBusca } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.get("/livros/:q", (contexto) =>
    contexto.json(
      useCases.buscarLivro.execute(parseBusca(contexto.req.param())),
    ),
  );
}
