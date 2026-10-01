import { AcervoComoConsultaDeSolicitacoes } from "./adapters/AcervoComoConsultaDeSolicitacao";
import { AutoriaComoConsulta } from "./adapters/AutoriaComoConsulta";
import {
  BuscarLivro,
  CadastrarLivro,
  CorrigirIsbn,
  type LivroCatalogado,
  SqliteLivroRepository,
} from "./modules/acervo";
import { ProjecaoDeLivros, SqliteAutorRepository } from "./modules/autoria";
import { SqliteSolicitacaoRepository, RegistrarSolicitacao } from "./modules/solicitacao";
import type { Clock } from "./shared/Clock";
import { EventBus } from "./shared/EventBus";
import { AutorId } from "./shared/identifiers";

export type UseCases = {
  cadastrarLivro: CadastrarLivro;
  buscarLivro: BuscarLivro;
  corrigirIsbn: CorrigirIsbn;
  registrarSolicitacao: RegistrarSolicitacao;
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
  const solicitacoes = new SqliteSolicitacaoRepository();
  const acervo = new AcervoComoConsultaDeSolicitacoes(livros);

  bus.subscribe<LivroCatalogado>("LivroCatalogado", (event) =>
    projecao.registrarEntrada(new AutorId(event.autorId)),
  );

  return {
    cadastrarLivro: new CadastrarLivro(livros, autoria, now, bus),
    buscarLivro: new BuscarLivro(livros, autoria),
    corrigirIsbn: new CorrigirIsbn(livros),
    registrarSolicitacao: new RegistrarSolicitacao(solicitacoes, acervo)
  };
}
