import { parseBusca, parseNovoLivro } from "../input";
import type { Route } from "../router";
import { buscarLivros, cadastrarLivro } from "../services/livroService";

export const livroRoutes: Route[] = [
  {
    method: "POST",
    pattern: "/livros",
    handler: async (request) => {
      const data = parseNovoLivro(await request.json());

      const result = cadastrarLivro(data.isbn, data.titulo, data.autorId);

      if (!result.ok) {
        return Response.json({ error: result.error }, { status: result.status });
      }

      const livro = result.livro as { isbn: string };

      return Response.json(result.livro, {
        status: 201,
        headers: { Location: `/livros/${livro.isbn}` },
      });
    },
  },
  {
    method: "GET",
    pattern: "/livros/:q",
    handler: (_request, params) => {
      return Response.json(buscarLivros(parseBusca(params)));
    },
  },
];
