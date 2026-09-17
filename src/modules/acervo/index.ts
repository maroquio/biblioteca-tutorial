export { CadastrarLivro } from "./features/cadastrar-livro/CadastrarLivro";
export { BuscarLivro } from "./features/buscar-livro/BuscarLivro";
export { DarBaixa } from "./features/dar-baixa/DarBaixa";
export { SqliteLivroRepository } from "./infrastructure/SqliteLivroRepository";
export { createAcervoTables } from "./infrastructure/schema";
export type {
  AutorConhecido,
  ConsultaDeAutoria,
  Tiragem,
} from "./domain/ConsultaDeAutoria";
export type {
  AcervoEvent,
  EventPublisher,
  LivroBaixado,
  LivroCatalogado,
} from "./domain/events";
export type { LivroJson } from "./output";
export { registerRoutes } from "./routes";