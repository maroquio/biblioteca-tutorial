export { CadastrarLivro } from "./features/cadastrar-livro/CadastrarLivro";
export { BuscarLivro } from "./features/buscar-livro/BuscarLivro";
export { RegistrarAvaliacao } from "./features/registrar-avaliacao/RegistrarAvaliacao";

export { SqliteLivroRepository } from "./infrastructure/SqliteLivroRepository";
export { SqliteAvaliacaoRepository } from "./infrastructure/SqliteAvaliacaoRepository";

export { createAcervoTables } from "./infrastructure/schema";
export type {
  AutorConhecido,
  ConsultaDeAutoria,
  Tiragem,
} from "./domain/ConsultaDeAutoria";
export type {
  AcervoEvent,
  EventPublisher,
  LivroCatalogado,
} from "./domain/events";
export type { LivroJson } from "./output";
export { registerRoutes } from "./routes";
export type {ConsultaDeAcervo} from "./ConsultaDeAcervo"
export type {ConsultaDeLivros} from "./ConsultaDeLivros"
