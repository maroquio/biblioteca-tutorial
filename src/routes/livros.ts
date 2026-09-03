import { parseBusca, parseNovoLivro } from "../input";
import { SqliteAutorRepository } from "../repositories/SqliteAutorRepository";
import { SqliteLivroRepository } from "../repositories/SqliteLivroRepository";
import type { Route } from "../router";
import { BuscarLivro } from "../use-cases/BuscarLivro";
import { CadastrarLivro } from "../use-cases/CadastrarLivro";

// ⚠️ defeito proposital: a rota não deveria escolher a implementação.
// Isto some na fase 42, quando o composition root existir.
const livros = new SqliteLivroRepository();
const autores = new SqliteAutorRepository();
const cadastrarLivro = new CadastrarLivro(livros, autores, () => new Date());
const buscarLivro = new BuscarLivro(livros, autores);

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
      Response.json(buscarLivro.execute(parseBusca(params))),
  },
];
