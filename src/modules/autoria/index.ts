/**
 * API pública do módulo Autoria.
 * `Autor`, `TipoDeAutor` e `AutorRepository` aparecem aqui porque o módulo
 * Acervo ainda depende deles — isso vai incomodar na fase 49.
 */
export { Autor } from "./domain/Autor";
export type { TipoDeAutor } from "./domain/Autor";
export type { AutorRepository } from "./domain/AutorRepository";
export { SqliteAutorRepository } from "./infrastructure/SqliteAutorRepository";
