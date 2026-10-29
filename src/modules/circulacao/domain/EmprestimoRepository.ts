import type { EmprestimoId } from "../../../shared/identifiers";
import type { Emprestimo } from "./Emprestimo";

export interface EmprestimoRepository {
  /** A persistência atribui a identidade e devolve o empréstimo já identificado. */
  insert(emprestimo: Emprestimo): Emprestimo;

  findById(id: EmprestimoId): Emprestimo | null;

  /** Devolvem o histórico inteiro; quem diz o que está "em aberto" é a entidade. */
  doExemplar(numeroRegistro: string): Emprestimo[];
  doLeitor(matricula: string): Emprestimo[];

  /** Grava a devolução que a entidade já decidiu. */
  registrarDevolucao(emprestimo: Emprestimo): void;
}
