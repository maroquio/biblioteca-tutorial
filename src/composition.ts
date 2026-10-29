import { AcervoComoConsulta } from "./adapters/AcervoComoConsulta";
import { AcervoComoExemplares } from "./adapters/AcervoComoExemplares";
import { AutoriaComoConsulta } from "./adapters/AutoriaComoConsulta";
import {
  BuscarLivro,
  CadastrarLivro,
  DarBaixa,
  type LivroBaixado,
  type LivroCatalogado,
  SqliteLivroRepository,
} from "./modules/acervo";
import { CorrigirTitulo } from "./modules/acervo/features/corrigir-titulo/CorrigirTitulo";
import {
  CadastrarAutor,
  ConsultarAutor,
  ProjecaoDeLivros,
  SqliteAutorRepository,
} from "./modules/autoria";
import { RegistrarAvaliacao } from "./modules/avaliacao/features/cadastrar-avaliacao/CadastrarAvaliacao";
import { SqliteAvaliacaoRepository } from "./modules/avaliacao/infrastructure/SqliteAvaliacaoRepository";
import {
  DevolverLivro,
  EmprestarLivro,
  SqliteEmprestimoRepository,
} from "./modules/circulacao";
import type { Clock } from "./shared/Clock";
import { EventBus } from "./shared/EventBus";
import { AutorId } from "./shared/identifiers";

export type UseCases = {
  registrarAvaliacao: RegistrarAvaliacao;
  corrigirTitulo: CorrigirTitulo;
  cadastrarLivro: CadastrarLivro;
  buscarLivro: BuscarLivro;
  darBaixa: DarBaixa;
  cadastrarAutor: CadastrarAutor;
  consultarAutor: ConsultarAutor;
  emprestarLivro: EmprestarLivro;
  devolverLivro: DevolverLivro;
};

/**
 * Composition root: este é o ÚNICO lugar do sistema que sabe, ao mesmo tempo,
 * que existem casos de uso e que existe SQLite. Trocar de banco é trocar as
 * três linhas de `new Sqlite...` daqui.
 */
export function buildUseCases(now: Clock = () => new Date()): UseCases {
  const livros = new SqliteLivroRepository();
  const autores = new SqliteAutorRepository();
  const emprestimos = new SqliteEmprestimoRepository();
  const avaliacoes = new SqliteAvaliacaoRepository();
  const autoria = new AutoriaComoConsulta(autores);
  const acervo = new AcervoComoConsulta(livros);
  const exemplares = new AcervoComoExemplares(livros);
  const bus = new EventBus();
  const projecao = new ProjecaoDeLivros(autores);

  bus.subscribe<LivroCatalogado>("LivroCatalogado", (event) =>
    projecao.registrarEntrada(new AutorId(event.autorId)),
  );

  bus.subscribe<LivroBaixado>("LivroBaixado", (event) =>
    projecao.registrarSaida(new AutorId(event.autorId)),
  );

  return {
    registrarAvaliacao: new RegistrarAvaliacao(avaliacoes, livros),
    corrigirTitulo: new CorrigirTitulo(livros),
    cadastrarLivro: new CadastrarLivro(livros, autoria, now, bus),
    buscarLivro: new BuscarLivro(livros, autoria),
    darBaixa: new DarBaixa(livros, autoria, now, bus),
    cadastrarAutor: new CadastrarAutor(autores),
    consultarAutor: new ConsultarAutor(autores, acervo),
    emprestarLivro: new EmprestarLivro(emprestimos, exemplares, now),
    devolverLivro: new DevolverLivro(emprestimos, exemplares, now),
  };
}
