/**
 * API pública do módulo Autoria: o contrato de leitura que ela OFERECE, o que
 * ela PRECISA do Acervo — os dois no vocabulário da Autoria — e as
 * implementações que o composition root instancia. `Autor`, `TipoDeAutor` e
 * `AutorRepository` continuam fora: ninguém de fora precisa deles.
 */
export type { ConsultaDeAutores, ResumoDoAutor } from "./ConsultaDeAutores";
export type { ConsultaDeAcervo, Obra } from "./domain/ConsultaDeAcervo";
export { CadastrarAutor } from "./features/cadastrar-autor/CadastrarAutor";
export { ConsultarAutor } from "./features/consultar-autor/ConsultarAutor";
export { ProjecaoDeLivros } from "./ProjecaoDeLivros";
export { SqliteAutorRepository } from "./infrastructure/SqliteAutorRepository";
export { createAutoriaTables } from "./infrastructure/schema";
export type { AutorComObrasJson, AutorJson } from "./output";
export { registerRoutes } from "./routes";
