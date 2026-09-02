import { TituloVazio } from "./errors";
import type { LivroId, AutorId } from "./identifiers";
import type { Isbn } from "./Isbn";
import type { NumeroRegistro } from "./NumeroRegistro";

export class Livro {
  constructor(
    readonly id: LivroId,
    readonly numeroRegistro: NumeroRegistro,
    readonly isbn: Isbn,
    readonly titulo: string,
    readonly autorId: AutorId,
    readonly dataCatalogacao: string,
  ) {
    if (Livro.normalizar(titulo) === "") {
      throw new TituloVazio();
    }
  }

  /** O que conta como "a mesma obra" é decisão do negócio, não do SQL. */
  mesmoTituloQue(outro: string): boolean {
    return Livro.normalizar(this.titulo) === Livro.normalizar(outro);
  }

  private static normalizar(titulo: string): string {
    return titulo.trim().toLowerCase();
  }
}
