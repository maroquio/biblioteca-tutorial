import { AutoriaComoConsulta } from "./adapters/AutoriaComoConsulta";
import {
  BuscarLivro,
  CadastrarLivro,
  type LivroCatalogado,
  SqliteLivroRepository,
} from "./modules/acervo";
import { ProjecaoDeLivros, SqliteAutorRepository } from "./modules/autoria";
import { RegistrarAvaliacao } from "./modules/avaliacao/features/registrar-avaliacao/RegistrarAvaliacao";
import { SqliteAvaliacaoRepository } from "./modules/avaliacao/infrastructure/SqliteAvaliacaoRepository";
import { AcervoComoConsultaDeAvaliacoes } from "./shared/AcervoComoConsultaDeAvaliacoes";
import type { Clock } from "./shared/Clock";
import { EventBus } from "./shared/EventBus";
import { AutorId } from "./shared/identifiers";

export type UseCases = {
  cadastrarLivro: CadastrarLivro;
  buscarLivro: BuscarLivro;
  registrarAvaliacao: RegistrarAvaliacao;
};

/**
 * Composition root: este é o ÚNICO lugar do sistema que sabe, ao mesmo tempo,
 * que existem casos de uso e que existe SQLite. Trocar de banco é trocar as
 * duas linhas de `new Sqlite...` daqui.
 */
export function buildUseCases(now: Clock = () => new Date()): UseCases {
  const livros = new SqliteLivroRepository();
  const autores = new SqliteAutorRepository();
  const avaliacoes = new SqliteAvaliacaoRepository();
  const autoria = new AutoriaComoConsulta(autores);
  const acervoComoConsultaDeAvaliacoes = new AcervoComoConsultaDeAvaliacoes(livros);
  const bus = new EventBus();
  const projecao = new ProjecaoDeLivros(autores);

  bus.subscribe<LivroCatalogado>("LivroCatalogado", (event) =>
    projecao.registrarEntrada(new AutorId(event.autorId)),
  );

  return {
    cadastrarLivro: new CadastrarLivro(livros, autoria, now, bus),
    buscarLivro: new BuscarLivro(livros, autoria),
    registrarAvaliacao: new RegistrarAvaliacao(
      avaliacoes,
      acervoComoConsultaDeAvaliacoes
    ),
  };
}
