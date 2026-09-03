import { db } from "../../../infrastructure/db";

// O id vai explícito de propósito: é ele que faz o INSERT OR IGNORE ser
// idempotente, e é ele que os exemplos deste documento referenciam.
const AUTORES = [
  [1, "Eric Evans", "didatico"],
  [2, "Robert C. Martin", "didatico"],
  [3, "Harper Lee", "literatura"],
  [4, "Jane Austen", "literatura"],
] as const;

/** O módulo Autoria é o dono da tabela `autores` — e da carga inicial dela. */
export function createAutoriaTables(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS autores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      orcid TEXT UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'literatura',
      livros_no_acervo INTEGER NOT NULL DEFAULT 0
    );
  `);

  addLivrosNoAcervoIfMissing();

  const insert = db.prepare(
    "INSERT OR IGNORE INTO autores (id, nome, tipo) VALUES (?, ?, ?)",
  );

  for (const [id, nome, tipo] of AUTORES) {
    insert.run(id, nome, tipo);
  }
}

/** Banco criado antes desta fase não tem a coluna — e a projeção nasce zerada. */
function addLivrosNoAcervoIfMissing(): void {
  const colunas = db.query("PRAGMA table_info(autores)").all() as {
    name: string;
  }[];

  if (colunas.some((coluna) => coluna.name === "livros_no_acervo")) return;

  db.run(
    "ALTER TABLE autores ADD COLUMN livros_no_acervo INTEGER NOT NULL DEFAULT 0",
  );

  console.log("Migração aplicada: coluna livros_no_acervo acrescentada a autores");
}
