import { Hono } from "hono";
import { parseBusca, parseNovoLivro } from "../../application/input";
import type { UseCases } from "../../composition";

export function livroRoutes(useCases: UseCases): Hono {
  const routes = new Hono();

  routes.post("/livros", async (contexto) => {
    const livro = useCases.cadastrarLivro.execute(
      parseNovoLivro(await contexto.req.json()),
    );

    contexto.header("Location", `/livros/${livro.isbn}`);

    return contexto.json(livro, 201);
  });

  routes.get("/livros/:q", (contexto) =>
    contexto.json(useCases.buscarLivro.execute(parseBusca(contexto.req.param()))),
  );

  return routes;
}
