import { db } from "../db";

export type LivroRow = {
  id: number;
  numero_registro: string;
  isbn: string;
  titulo: string;
  autor_id: number;
  data_catalogacao: string;
};

export function contarNoAcervoDoAutor(autorId: number): number {
  const row = db
    .query("SELECT COUNT(*) AS total FROM livros WHERE autor_id = ?")
    .get(autorId) as { total: number };

  return row.total;
}

export function contarCatalogadosNoAno(ano: string): number {
  const row = db
    .query(
      `SELECT COUNT(*) AS total FROM livros
        WHERE data_catalogacao LIKE ?`,
    )
    .get(`${ano}%`) as { total: number };

  return row.total;
}

export function findLivroById(id: number): LivroRow | null {
  return db.query("SELECT * FROM livros WHERE id = ?").get(id) as
    | LivroRow
    | null;
}

export function findLivroByIsbn(isbn: string): LivroRow | null {
  return db.query("SELECT * FROM livros WHERE isbn = ?").get(isbn) as
    | LivroRow
    | null;
}

export function findLivrosByAutorId(autorId: number): LivroRow[] {
  return db
    .query("SELECT * FROM livros WHERE autor_id = ?")
    .all(autorId) as LivroRow[];
}

export function insertLivro(
  numeroRegistro: string,
  isbn: string,
  titulo: string,
  autorId: number,
  dataCatalogacao: string,
): LivroRow {
  const result = db.run(
    `INSERT INTO livros (numero_registro, isbn, titulo, autor_id, data_catalogacao)
     VALUES (?, ?, ?, ?, ?)`,
    [numeroRegistro, isbn, titulo, autorId, dataCatalogacao],
  );

  return findLivroById(Number(result.lastInsertRowid))!;
}

export function searchLivrosPorTitulo(termo: string): LivroRow[] {
  return db
    .query("SELECT * FROM livros WHERE titulo LIKE ?")
    .all(`%${termo}%`) as LivroRow[];
}

// ⚠️ ainda lê a tabela do outro lado da fronteira. Fase 50.
export function searchLivrosPorNomeDoAutor(termo: string): LivroRow[] {
  return db
    .query(
      `SELECT livros.* FROM livros
         JOIN autores ON autores.id = livros.autor_id
        WHERE autores.nome LIKE ?`,
    )
    .all(`%${termo}%`) as LivroRow[];
}
