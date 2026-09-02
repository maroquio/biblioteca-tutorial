import { Database } from "bun:sqlite";

export const db = new Database("data/biblioteca.sqlite", { create: true });

db.run("PRAGMA foreign_keys = ON;");

// O id vai explícito de propósito: é ele que faz o INSERT OR IGNORE ser
// idempotente, e é ele que os exemplos deste documento referenciam.
// O ORCID é nulo para os quatro — três morreram antes de ele existir.
const AUTORES = [
  [1, "Eric Evans", "didatico"],
  [2, "Robert C. Martin", "didatico"],
  [3, "Harper Lee", "literatura"],
  [4, "Jane Austen", "literatura"],
] as const;

function seedAutores() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO autores (id, nome, tipo) VALUES (?, ?, ?)",
  );

  for (const [id, nome, tipo] of AUTORES) {
    insert.run(id, nome, tipo);
  }
}

export function createDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS autores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      orcid TEXT UNIQUE,
      tipo TEXT NOT NULL DEFAULT 'literatura'
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS livros (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_registro TEXT NOT NULL UNIQUE,
      isbn TEXT NOT NULL UNIQUE,
      titulo TEXT NOT NULL,
      autor_id INTEGER NOT NULL,
      data_catalogacao TEXT NOT NULL,
      FOREIGN KEY (autor_id) REFERENCES autores(id)
    );
  `);

  seedAutores();

  console.log("Banco de dados inicializado.");
}
