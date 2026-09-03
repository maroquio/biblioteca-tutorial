import type { Clock } from "./domain/Clock";
import { SqliteAutorRepository } from "./repositories/SqliteAutorRepository";
import { SqliteLivroRepository } from "./repositories/SqliteLivroRepository";
import { BuscarLivro } from "./use-cases/BuscarLivro";
import { CadastrarLivro } from "./use-cases/CadastrarLivro";

export type UseCases = {
  cadastrarLivro: CadastrarLivro;
  buscarLivro: BuscarLivro;
};

/**
 * Composition root: este é o ÚNICO lugar do sistema que sabe, ao mesmo tempo,
 * que existem casos de uso e que existe SQLite. Trocar de banco é trocar as
 * duas linhas de `new Sqlite...` daqui.
 */
export function buildUseCases(now: Clock = () => new Date()): UseCases {
  const livros = new SqliteLivroRepository();
  const autores = new SqliteAutorRepository();

  return {
    cadastrarLivro: new CadastrarLivro(livros, autores, now),
    buscarLivro: new BuscarLivro(livros, autores),
  };
}
