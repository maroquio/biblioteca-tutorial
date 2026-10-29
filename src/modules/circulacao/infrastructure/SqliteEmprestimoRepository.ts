import { db } from "../../../infrastructure/db";
import { EmprestimoId } from "../../../shared/identifiers";
import { Emprestimo } from "../domain/Emprestimo";
import type { EmprestimoRepository } from "../domain/EmprestimoRepository";

type EmprestimoRow = {
  id: number;
  numero_registro: string;
  matricula: string;
  emprestado_em: string;
  devolver_ate: string;
  devolvido_em: string | null;
};

function toEmprestimo(row: EmprestimoRow): Emprestimo {
  return new Emprestimo(
    new EmprestimoId(row.id),
    row.numero_registro,
    row.matricula,
    row.emprestado_em,
    row.devolver_ate,
    row.devolvido_em,
  );
}

export class SqliteEmprestimoRepository implements EmprestimoRepository {
  insert(emprestimo: Emprestimo): Emprestimo {
    const result = db.run(
      `INSERT INTO emprestimos (numero_registro, matricula, emprestado_em, devolver_ate)
       VALUES (?, ?, ?, ?)`,
      [
        emprestimo.numeroRegistro,
        emprestimo.matricula,
        emprestimo.emprestadoEm,
        emprestimo.devolverAte,
      ],
    );

    return emprestimo.withId(new EmprestimoId(Number(result.lastInsertRowid)));
  }

  findById(id: EmprestimoId): Emprestimo | null {
    const row = db
      .query("SELECT * FROM emprestimos WHERE id = ?")
      .get(id.value) as EmprestimoRow | null;

    return row === null ? null : toEmprestimo(row);
  }

  doExemplar(numeroRegistro: string): Emprestimo[] {
    const rows = db
      .query("SELECT * FROM emprestimos WHERE numero_registro = ?")
      .all(numeroRegistro) as EmprestimoRow[];

    return rows.map(toEmprestimo);
  }

  doLeitor(matricula: string): Emprestimo[] {
    const rows = db
      .query("SELECT * FROM emprestimos WHERE matricula = ?")
      .all(matricula) as EmprestimoRow[];

    return rows.map(toEmprestimo);
  }

  registrarDevolucao(emprestimo: Emprestimo): void {
    db.run("UPDATE emprestimos SET devolvido_em = ? WHERE id = ?", [
      emprestimo.devolvidoEm,
      emprestimo.id!.value,
    ]);
  }
}
