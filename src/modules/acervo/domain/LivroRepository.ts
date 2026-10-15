import type { AutorId, LivroId } from "../../../shared/identifiers";
import type { Isbn } from "./Isbn";
import type { Livro } from "./Livro";

export interface LivroRepository {
  contarNoAcervoDoAutor(autorId: AutorId): number;
  contarCatalogadosNoAno(ano: string): number;

  insert(livro: Livro): Livro;
  findByIsbn(isbn: Isbn): Livro | null;
  findById(id: LivroId): Livro | null;
  findByAutorId(autorId: AutorId): Livro[];
  searchByTitulo(termo: string): Livro[];
  findByAutorIds(autorIds: AutorId[]): Livro[];
  updateTitulo(livro: Livro): void;
}
