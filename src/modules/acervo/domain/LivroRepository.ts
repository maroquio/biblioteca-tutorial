import type { AutorId } from "../../../shared/identifiers";
import type { Isbn } from "./Isbn";
import type { Livro } from "./Livro";
import type { NumeroRegistro } from "./NumeroRegistro";

/**
 * Port: quem PRECISA do serviço declara o contrato. Esta interface vive no
 * domínio e não sabe que existe SQLite, HTTP ou qualquer outra tecnologia.
 * Repare que a primeira assinatura é uma pergunta de negócio, não uma
 * consulta.
 */
export interface LivroRepository {
  contarCatalogadosNoAno(ano: string): number;

  insert(livro: Livro): Livro;
  findByIsbn(isbn: Isbn): Livro | null;
  findByNumeroRegistro(numero: NumeroRegistro): Livro | null;
  findByAutorId(autorId: AutorId): Livro[];
  searchByTitulo(termo: string): Livro[];
  findByAutorIds(autorIds: AutorId[]): Livro[];

  /** Grava a baixa que a entidade já decidiu. Não decide nada. */
  registrarBaixa(livro: Livro): void;
}