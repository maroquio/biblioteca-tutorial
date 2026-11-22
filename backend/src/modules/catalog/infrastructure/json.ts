import type { BookView } from "../domain/Book";
import type { CopyView } from "../domain/Copy";

/** UC25: o endereço da capa, com a data da última troca; null se o livro não tem capa. */
function coverUrl(book: BookView): string | null {
  return book.coverUpdatedAt ? `/api/livros/${book.id}/capa?v=${book.coverUpdatedAt.getTime()}` : null;
}

/** JSON da API do Acervo: as chaves continuam em português, na mesma ordem de sempre. */
export function bookJson(book: BookView) {
  return {
    id: book.id, isbn: book.isbn, titulo: book.title, autorId: book.authorId,
    autor: book.authorName, dataCatalogacao: book.catalogedOn,
    livrosDoAutor: book.authorBookCount, totalExemplares: book.totalCopies,
    exemplaresDisponiveis: book.availableCopies, capaUrl: coverUrl(book),
  };
}

/** UC24: o livro, mais a distância cosseno até a consulta (0 = mesmo sentido). */
export function semanticBookJson({ book, distance }: { book: BookView; distance: number }) {
  return { ...bookJson(book), distancia: Number(distance.toFixed(4)) };
}

export function copyJson(copy: CopyView) {
  return {
    id: copy.id, livroId: copy.bookId, numeroRegistro: copy.registrationNumber,
    localizacao: copy.location, estadoConservacao: copy.condition,
    dataCatalogacao: copy.catalogedOn, titulo: copy.title, isbn: copy.isbn,
    situacao: copy.status,
  };
}
