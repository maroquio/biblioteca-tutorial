import type { AuthorView } from "../domain/Author";

/** UC26: o endereço da foto, com a versão na query string; null se o autor não tem foto. */
function photoUrl(author: AuthorView): string | null {
  return author.photoVersion === null ? null : `/api/autores/${author.id}/foto?v=${author.photoVersion}`;
}

/** JSON da API, em português. */
export function authorJson(author: AuthorView) {
  return { id: author.id, nome: author.name, tipo: author.type, livrosNoAcervo: author.bookCount, fotoUrl: photoUrl(author) };
}
