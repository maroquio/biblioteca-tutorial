export { RegistrarAvaliacao } from "./features/registrar-avaliacao/RegistrarAvaliacao";
export { SqliteAvaliacaoRepository } from "./infrastructure/SqliteAvaliacaoRepository";
export { createAvaliacaoTables } from "./infrastructure/schema";
export type {
    ConsultaDeAcervo
} from "./domain/ConsultaDeAcervo";
export type { AvaliacaoJson } from "./output";
export { registerRoutes } from "./routes";
