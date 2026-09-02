import { parseBusca, parseNovoLivro } from "../input";
import type { Route } from "../router";
import { buscarLivros, cadastrarLivro } from "../services/livroService";

export const livroRoutes: Route[] = [
  {
    method: "POST",
    pattern: "/livros",
    handler: async (request) => {
      const data = parseNovoLivro(await request.json());

      const livro = cadastrarLivro(data.isbn, data.titulo, data.autorId) as {
        isbn: string;
      };

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
      Response.json(buscarLivros(parseBusca(params))),
  },
];
