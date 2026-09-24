import type { Emprestimo } from "./domain/Emprestimo";

export type EmprestimoJson = {
  id: number;
  numeroRegistro: string;
  titulo: string;
  matricula: string;
  emprestadoEm: string;
  devolverAte: string;
  devolvidoEm: string | null;
  diasDeAtraso: number;
};

export function emprestimoToJson(
  emprestimo: Emprestimo,
  titulo: string,
): EmprestimoJson {
  return {
    id: emprestimo.id!.value,
    numeroRegistro: emprestimo.numeroRegistro,
    titulo,
    matricula: emprestimo.matricula,
    emprestadoEm: emprestimo.emprestadoEm,
    devolverAte: emprestimo.devolverAte,
    devolvidoEm: emprestimo.devolvidoEm,
    diasDeAtraso: emprestimo.diasDeAtraso(),
  };
}