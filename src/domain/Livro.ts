import { TituloVazio } from "./errors";

export class Livro {
  constructor(
    readonly id: number,
    readonly numeroRegistro: string,
    readonly isbn: string,
    readonly titulo: string,
    readonly autorId: number,
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
