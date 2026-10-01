export { RegistrarSolicitacao } from "./features/registrar-solicitacao/RegistrarSolicitacao";
export { SqliteSolicitacaoRepository } from "./infrastructure/SqliteSolicitacaoRepository";
export { createSolicitacaoTables } from "./infrastructure/schema";
export type { SolicitacaoJson } from "./output";
export { registerRoutes } from "./routes";
export type { ConsultaDeAcervo } from "./domain/ConsultaDeAcervo";