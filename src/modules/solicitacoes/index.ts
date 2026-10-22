export type { ConsultaDeAcervo } from "./domain/ConsultaDeAcervo";
export { RegistrarSolicitacao } from "./features/registrar-solicitacao/RegistrarSolicitacao";
export { createSolicitacaoTables } from "./infrastructure/schema";
export { SqliteSolicitacaoRepository } from "./infrastructure/SqliteSolicitacaoRepository";
export type { SolicitacaoJson } from "./output";
export { registerRoutes } from "./routes";
