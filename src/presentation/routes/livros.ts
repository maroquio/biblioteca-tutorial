import type { UseCases } from "../../composition";
import { parseBusca, parseNovoLivro } from "../../application/input";
import type { Route } from "../router";

export function livroRoutes(useCases: UseCases): Route[] {
  return [
    {
      method: "POST",
      pattern: "/livros",
      handler: async (request) => {
        const livro = useCases.cadastrarLivro.execute(
          parseNovoLivro(await request.json()),
        );

        return Response.json(livro, {
          status: 201,
          headers: { Location: `/livros/${livro.isbn}` },
        });
      },
    },
    {
      method: "GET",
      pattern: "/livros/:q",
      handler: (_request, params) =>
        Response.json(useCases.buscarLivro.execute(parseBusca(params))),
    },
  ];
}
