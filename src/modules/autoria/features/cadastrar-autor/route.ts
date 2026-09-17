import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseNovoAutor } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/autores", async (contexto) => {
    const autor = useCases.cadastrarAutor.execute(
      parseNovoAutor(await contexto.req.json()),
    );

    contexto.header("Location", `/autores/${autor.id}`);

    return contexto.json(autor, 201);
  });
}