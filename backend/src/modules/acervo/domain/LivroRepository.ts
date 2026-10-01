import type { AutorId } from "../../../shared/identifiers";
import type { Isbn } from "./Isbn";
import type { Livro } from "./Livro";

/**
 * Port: quem PRECISA do serviço declara o contrato. Esta interface vive no
 * domínio e não sabe que existe SQLite, HTTP ou qualquer outra tecnologia.
 * Repare que as duas primeiras assinaturas são perguntas de negócio, não
 * consultas.
 *
 * Todas devolvem Promise: falar com um banco é I/O, e I/O leva tempo. O
 * contrato síncrono só funcionava porque o SQLite embutido responde na hora.
 */
export interface LivroRepository {
  contarNoAcervoDoAutor(autorId: AutorId): Promise<number>;
  contarCatalogadosNoAno(ano: string): Promise<number>;

  insert(livro: Livro): Promise<Livro>;
  findByIsbn(isbn: Isbn): Promise<Livro | null>;
  findByAutorId(autorId: AutorId): Promise<Livro[]>;
  searchByTitulo(termo: string): Promise<Livro[]>;
  findByAutorIds(autorIds: AutorId[]): Promise<Livro[]>;
}
