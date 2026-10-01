export { registerRoutes } from "./routes";
export { RegistrarSolicitacao } from "./features/registrar-solicitacao/RegistrarSolicitacao";
export { SqliteSolicitacaoRepository } from "./infrastructure/SqliteSolicitacaoRepository";
export {createSolicitacaoTables} from "./infrastructure/schema";
export type { NovaSolicitacao } from "./features/registrar-solicitacao/input";   
export type { SolicitacaoJson } from "./output";





