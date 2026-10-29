import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseAutorId } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.get("/autores/:id", (contexto) =>
    contexto.json(
      useCases.consultarAutor.execute(parseAutorId(contexto.req.param())),
    ),
  );
}
