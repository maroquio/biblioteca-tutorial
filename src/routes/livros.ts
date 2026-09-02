import type { Route } from "../router";
import { buscarLivros, cadastrarLivro } from "../services/livroService";

export const livroRoutes: Route[] = [
  {
    method: "POST",
    pattern: "/livros",
    handler: async (request) => {
      const body = (await request.json()) as {
        isbn: string;
        titulo: string;
        autorId: number;
      };

      const result = cadastrarLivro(body.isbn, body.titulo, body.autorId);

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
      return Response.json(buscarLivros(params.q!));
    },
  },
];
