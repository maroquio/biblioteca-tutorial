import { db } from "../../../infrastructure/db";

const COLUMNS = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero_registro TEXT NOT NULL UNIQUE,
  isbn TEXT NOT NULL UNIQUE,
  titulo TEXT NOT NULL,
  autor_id INTEGER NOT NULL,
  data_catalogacao TEXT NOT NULL
`;

/**
 * O módulo Acervo é o dono da tabela `livros`.
 * `autor_id` é apenas um inteiro: referência a um agregado de outro módulo,
 * sem chave estrangeira. Quem garante que o autor existe é o caso de uso,
 * através da port ConsultaDeAutoria.
 */
export function createAcervoTables(): void {
  db.run(`CREATE TABLE IF NOT EXISTS livros (${COLUMNS});`);

  dropCrossModuleForeignKeys();
}

function dropCrossModuleForeignKeys(): void {
  const foreignKeys = db.query("PRAGMA foreign_key_list(livros)").all();

  if (foreignKeys.length === 0) return;

  db.run("PRAGMA foreign_keys = OFF;");
  db.run(`CREATE TABLE livros_novo (${COLUMNS});`);
  db.run(`
    INSERT INTO livros_novo
      (id, numero_registro, isbn, titulo, autor_id, data_catalogacao)
    SELECT id, numero_registro, isbn, titulo, autor_id, data_catalogacao
      FROM livros;
  `);
  db.run("DROP TABLE livros;");
  db.run("ALTER TABLE livros_novo RENAME TO livros;");
  db.run("PRAGMA foreign_keys = ON;");

  console.log(
    `Migração aplicada: ${foreignKeys.length} chave(s) estrangeira(s) cruzada(s) removida(s) de livros`,
  );
}
