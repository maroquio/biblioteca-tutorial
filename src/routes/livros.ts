import type { Autor } from "../domain/Autor";
import type { Livro } from "../domain/Livro";
import { parseBusca, parseNovoLivro } from "../input";
import type { Route } from "../router";
import { buscarLivros, cadastrarLivro } from "../services/livroService";

function toJson(livro: Livro, autor: Autor) {
  return {
    id: livro.id.value,
    numeroRegistro: livro.numeroRegistro.value,
    isbn: livro.isbn.value,
    titulo: livro.titulo,
    autor: autor.nome,
    dataCatalogacao: livro.dataCatalogacao,
  };
}

export const livroRoutes: Route[] = [
  {
    method: "POST",
    pattern: "/livros",
    handler: async (request) => {
      const data = parseNovoLivro(await request.json());

      const { livro, autor } = cadastrarLivro(data.isbn, data.titulo, data.autorId);

      return Response.json(toJson(livro, autor), {
        status: 201,
        headers: { Location: `/livros/${livro.isbn.value}` },
      });
    },
  },
  {
    method: "GET",
    pattern: "/livros/:q",
    handler: (_request, params) =>
      Response.json(
        buscarLivros(parseBusca(params)).map(({ livro, autor }) =>
          toJson(livro, autor),
        ),
      ),
  },
];
