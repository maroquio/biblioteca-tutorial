import type { Autor } from "../domain/Autor";
import type { Livro } from "../domain/Livro";
import { parseBusca, parseNovoLivro } from "../input";
import { SqliteAutorRepository } from "../repositories/SqliteAutorRepository";
import { SqliteLivroRepository } from "../repositories/SqliteLivroRepository";
import type { Route } from "../router";
import { buscarLivros } from "../services/livroService";
import { CadastrarLivro } from "../use-cases/CadastrarLivro";

// ⚠️ defeito proposital: a rota não deveria escolher a implementação.
// Isto some na fase 42, quando o composition root existir.
const livros = new SqliteLivroRepository();
const autores = new SqliteAutorRepository();
const cadastrarLivro = new CadastrarLivro(livros, autores, () => new Date());

function toJson(livro: Livro, autor: Autor) {
  return {
    id: livro.id!.value,
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
      const livro = cadastrarLivro.execute(parseNovoLivro(await request.json()));

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
      Response.json(
        buscarLivros(livros, autores, parseBusca(params)).map(
          ({ livro, autor }) => toJson(livro, autor),
        ),
      ),
  },
];
