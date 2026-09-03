import type { Hono } from "hono";
import type { UseCases } from "../../composition";
import { parseNovoLivro } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/livros", async (contexto) => {
    const livro = useCases.cadastrarLivro.execute(
      parseNovoLivro(await contexto.req.json()),
    );

    contexto.header("Location", `/livros/${livro.isbn}`);

    return contexto.json(livro, 201);
  });
}
