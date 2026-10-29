import { Hono } from "hono";
import { UseCases } from "../../use-cases";
import { parseCorrecaoDeIsbn } from "./parse-correcao-de-isbn";

export function register(routes: Hono, useCases: UseCases): void {
  routes.patch("/livros/:id/isbn", async (contexto) => {
    const input = parseCorrecaoDeIsbn(
      contexto.req.param(),
      await contexto.req.json(),
    );
    return contexto.json(useCases.corrigirIsbn.execute(input), 200);
  });
}