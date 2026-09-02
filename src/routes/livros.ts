import { db } from "../db";
import type { Route } from "../router";
import { cadastrarLivro } from "../services/livroService";

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
      const q = params.q!;

      const porIsbn = db
        .query("SELECT * FROM livros WHERE isbn = ?")
        .all(q);

      if (porIsbn.length > 0) return Response.json(porIsbn);

      const porTitulo = db
        .query("SELECT * FROM livros WHERE titulo LIKE ?")
        .all(`%${q}%`);

      if (porTitulo.length > 0) return Response.json(porTitulo);

      const porAutor = db
        .query(
          `SELECT livros.* FROM livros
             JOIN autores ON autores.id = livros.autor_id
            WHERE autores.nome LIKE ?`,
        )
        .all(`%${q}%`);

      return Response.json(porAutor);
    },
  },
];
