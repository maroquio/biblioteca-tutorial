/**
 * API pública do módulo Circulação: o que ela precisa do Acervo, no
 * vocabulário dela, e o que o composition root instancia. `Emprestimo` e
 * `EmprestimoRepository` ficam dentro: ninguém de fora precisa deles.
 */
export type {
  ConsultaDeExemplares,
  ExemplarConhecido,
} from "./domain/ConsultaDeExemplares";
export { DevolverLivro } from "./features/devolver-livro/DevolverLivro";
export { EmprestarLivro } from "./features/emprestar-livro/EmprestarLivro";
export { SqliteEmprestimoRepository } from "./infrastructure/SqliteEmprestimoRepository";
export { createCirculacaoTables } from "./infrastructure/schema";
export type { EmprestimoJson } from "./output";
export { registerRoutes } from "./routes";
