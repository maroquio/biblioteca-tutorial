import { AcervoComoConsultaDeAvaliacoes } from "./adapters/AcervoComoConsultaDeAvaliacoes";
import { AutoriaComoConsulta } from "./adapters/AutoriaComoConsulta";
import {
  BuscarLivro,
  CadastrarLivro,
  RegistrarAvaliacao,
  type LivroCatalogado,
  type ConsultaDeAcervo,
  SqliteLivroRepository,
  SqliteAvaliacaoRepository
} from "./modules/acervo";
import { ProjecaoDeLivros, SqliteAutorRepository } from "./modules/autoria";
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
  const autoria = new AutoriaComoConsulta(autores);
  const bus = new EventBus();
  const projecao = new ProjecaoDeLivros(autores);

  const avaliacoes = new SqliteAvaliacaoRepository();
  const acervo = new AcervoComoConsultaDeAvaliacoes(livros);

  bus.subscribe<LivroCatalogado>("LivroCatalogado", (event) =>
    projecao.registrarEntrada(new AutorId(event.autorId)),
  );

  return {
    cadastrarLivro: new CadastrarLivro(livros, autoria, now, bus),
    buscarLivro: new BuscarLivro(livros, autoria),
    registrarAvaliacao: new RegistrarAvaliacao(avaliacoes, acervo),
  };
}
