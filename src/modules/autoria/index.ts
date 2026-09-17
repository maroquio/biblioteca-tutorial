/**
 * API pública do módulo Autoria: um contrato de leitura, no vocabulário da
 * Autoria, e a implementação que o composition root instancia. `Autor`,
 * `TipoDeAutor` e `AutorRepository` deixam de ser exportados — ninguém de
 * fora precisa mais deles.
 */
export type { ConsultaDeAutores, ResumoDoAutor } from "./ConsultaDeAutores";
export { CadastrarAutor } from "./features/cadastrar-autor/CadastrarAutor";
export { ProjecaoDeLivros } from "./ProjecaoDeLivros";
export { SqliteAutorRepository } from "./infrastructure/SqliteAutorRepository";
export { createAutoriaTables } from "./infrastructure/schema";
export type { AutorJson } from "./output";
export { registerRoutes } from "./routes";