import { Database } from "bun:sqlite";

export const db = new Database("data/biblioteca.sqlite", { create: true });

db.run("PRAGMA foreign_keys = ON;");

// O id vai explícito de propósito: é ele que faz o INSERT OR IGNORE ser
// idempotente, e é ele que os exemplos deste documento referenciam.
// O ORCID é nulo para os quatro — três morreram antes de ele existir.
const AUTORES = [
  [1, "Eric Evans"],
  [2, "Robert C. Martin"],
  [3, "Harper Lee"],
  [4, "Jane Austen"],
] as const;

function seedAutores() {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO autores (id, nome) VALUES (?, ?)",
  );

  for (const [id, nome] of AUTORES) {
    insert.run(id, nome);
  }
}

export function createDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS autores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      orcid TEXT UNIQUE
    );
  `);

  seedAutores();

  console.log("Banco de dados inicializado.");
}
