import { InvalidValue, RuleViolation } from "../../../shared/domain-errors";
import type { LivroId, AutorId } from "../../../shared/identifiers";
import type { Baixa } from "./Baixa";
import type { Isbn } from "./Isbn";
import { NumeroRegistro } from "./NumeroRegistro";

export class TituloVazio extends InvalidValue {
  constructor() {
    super("O título do livro é obrigatório");
  }
}

export class LivroJaBaixado extends RuleViolation {
  constructor(numeroRegistro: NumeroRegistro) {
    super(`O livro ${numeroRegistro.value} já saiu do acervo`);
  }
}

export function toIso(dia: Date): string {
  return dia.toISOString().slice(0, 10);
}

export class Livro {
  constructor(
    readonly id: LivroId | null,
    readonly numeroRegistro: NumeroRegistro,
    readonly isbn: Isbn,
    readonly titulo: string,
    readonly autorId: AutorId,
    readonly dataCatalogacao: string,
    readonly baixa: Baixa | null = null,
  ) {
    if (Livro.normalizar(titulo) === "") {
      throw new TituloVazio();
    }
  }

  /** Um livro nasce por aqui — e nasce válido. */
  static catalogar(
    isbn: Isbn,
    titulo: string,
    autorId: AutorId,
    hoje: Date,
    catalogadosNoAno: number,
  ): Livro {
    const dia = toIso(hoje);

    return new Livro(
      null,
      NumeroRegistro.proximo(dia.slice(0, 4), catalogadosNoAno),
      isbn,
      titulo,
      autorId,
      dia,
    );
  }

  /** Quem atribui a identidade é a persistência; a entidade aceita sem virar mutável. */
  withId(id: LivroId): Livro {
    return new Livro(
      id,
      this.numeroRegistro,
      this.isbn,
      this.titulo,
      this.autorId,
      this.dataCatalogacao,
      this.baixa,
    );
  }

  /** Um livro sai do acervo uma vez só. A entidade devolve outra, já baixada. */
  darBaixa(baixa: Baixa): Livro {
    if (!this.estaNoAcervo()) {
      throw new LivroJaBaixado(this.numeroRegistro);
    }

    return new Livro(
      this.id,
      this.numeroRegistro,
      this.isbn,
      this.titulo,
      this.autorId,
      this.dataCatalogacao,
      baixa,
    );
  }

  /** "Estar no acervo" é decisão do negócio, não um `WHERE` perdido numa query. */
  estaNoAcervo(): boolean {
    return this.baixa === null;
  }

  /** O que conta como "a mesma obra" é decisão do negócio, não do SQL. */
  mesmoTituloQue(outro: string): boolean {
    return Livro.normalizar(this.titulo) === Livro.normalizar(outro);
  }

  private static normalizar(titulo: string): string {
    return titulo.trim().toLowerCase();
  }
}