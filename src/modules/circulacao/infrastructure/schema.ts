import { db } from "../../../infrastructure/db";

/**
 * O módulo Circulação é o dono da tabela `emprestimos`. `numero_registro` é
 * só um texto: referência a um livro de outro módulo, sem chave estrangeira —
 * a mesma decisão que a fase 50 tomou para `livros.autor_id`.
 */
export function createCirculacaoTables(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS emprestimos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_registro TEXT NOT NULL,
      matricula TEXT NOT NULL,
      emprestado_em TEXT NOT NULL,
      devolver_ate TEXT NOT NULL,
      devolvido_em TEXT
    );
  `);
}
