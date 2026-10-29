
export type {
  ConsultaDeAcervo
} from "./domain/ConsultaDeAcervo";
export { RegistrarAvaliacao } from "./features/cadastrar-avaliacao/CadastrarAvaliacao";
export { SqliteAvaliacaoRepository } from "./infrastructure/SqliteAvaliacaoRepository";
export { createAvaliacaoTables } from "./infrastructure/schema";
export type { AvaliacaoJson } from "./output";
export { registerRoutes } from "./routes";
