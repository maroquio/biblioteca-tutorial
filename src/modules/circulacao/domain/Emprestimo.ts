import { RuleViolation } from "../../../shared/domain-errors";
import type { EmprestimoId } from "../../../shared/identifiers";

export class EmprestimoJaDevolvido extends RuleViolation {
  constructor() {
    super("Este empréstimo já foi devolvido");
  }
}

const UM_DIA = 24 * 60 * 60 * 1000;

function toIso(dia: Date): string {
  return dia.toISOString().slice(0, 10);
}

export class Emprestimo {
  static readonly PRAZO_EM_DIAS = 14;

  constructor(
    readonly id: EmprestimoId | null,
    /** Referência a um livro de outro módulo: só o número, nunca o Livro. */
    readonly numeroRegistro: string,
    readonly matricula: string,
    readonly emprestadoEm: string,
    readonly devolverAte: string,
    readonly devolvidoEm: string | null = null,
  ) {}

  /** Um empréstimo nasce por aqui — e já nasce com o prazo calculado. */
  static abrir(numeroRegistro: string, matricula: string, hoje: Date): Emprestimo {
    const prazo = new Date(hoje.getTime() + Emprestimo.PRAZO_EM_DIAS * UM_DIA);

    return new Emprestimo(
      null,
      numeroRegistro,
      matricula,
      toIso(hoje),
      toIso(prazo),
    );
  }

  withId(id: EmprestimoId): Emprestimo {
    return new Emprestimo(
      id,
      this.numeroRegistro,
      this.matricula,
      this.emprestadoEm,
      this.devolverAte,
      this.devolvidoEm,
    );
  }

  estaEmAberto(): boolean {
    return this.devolvidoEm === null;
  }

  /** Devolver é uma vez só. A entidade devolve outra, já fechada. */
  devolver(hoje: Date): Emprestimo {
    if (!this.estaEmAberto()) {
      throw new EmprestimoJaDevolvido();
    }

    return new Emprestimo(
      this.id,
      this.numeroRegistro,
      this.matricula,
      this.emprestadoEm,
      this.devolverAte,
      toIso(hoje),
    );
  }

  /** Quantos dias depois do prazo o livro voltou. Em aberto, ainda não se sabe. */
  diasDeAtraso(): number {
    if (this.devolvidoEm === null) return 0;

    const dias =
      (Date.parse(this.devolvidoEm) - Date.parse(this.devolverAte)) / UM_DIA;

    return Math.max(0, dias);
  }
}
