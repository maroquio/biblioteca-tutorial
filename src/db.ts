import { Database } from "bun:sqlite";

export const db = new Database("data/biblioteca.sqlite", { create: true });

db.run("PRAGMA foreign_keys = ON;");

export function createDb() {
  db.run(`
    CREATE TABLE IF NOT EXISTS autores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      orcid TEXT UNIQUE
    );
  `);

  console.log("Banco de dados inicializado.");
}
