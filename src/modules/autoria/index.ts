/**
 * API pública do módulo Autoria: um contrato de leitura, no vocabulário da
 * Autoria, e a implementação que o composition root instancia. `Autor`,
 * `TipoDeAutor` e `AutorRepository` deixam de ser exportados — ninguém de
 * fora precisa mais deles.
 */
export type { ConsultaDeAutores, ResumoDoAutor } from "./ConsultaDeAutores";
export { SqliteAutorRepository } from "./infrastructure/SqliteAutorRepository";
