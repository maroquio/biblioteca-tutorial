import type { Livro } from "../domain/Livro";
import { parseBusca, parseNovoLivro } from "../input";
import type { AutorRow } from "../repositories/autorRepository";
import type { Route } from "../router";
import { buscarLivros, cadastrarLivro } from "../services/livroService";

function toJson(livro: Livro, autor: AutorRow) {
  return {
    id: livro.id.value,
    numeroRegistro: livro.numeroRegistro,
    isbn: livro.isbn,
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
        headers: { Location: `/livros/${livro.isbn}` },
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
