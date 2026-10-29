/**
 * API pública do módulo Autoria: a preparação das tabelas, o contrato que a
 * integração implementa para contar os livros de cada autor e a invalidação do
 * cache de buscas, que outros módulos disparam quando mudam essa contagem.
 */
export { prepareAuthorship } from "./infrastructure/schema";
export type { AuthorshipDb, AuthorshipIntegration } from "./domain/AuthorshipIntegration";
export { invalidateAuthorSearch } from "./infrastructure/searchCache";
