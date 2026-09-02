import { db } from "../db";
import { Livro } from "../domain/Livro";

type LivroRow = {
  id: number;
  numero_registro: string;
  isbn: string;
  titulo: string;
  autor_id: number;
  data_catalogacao: string;
};

function toLivro(row: LivroRow): Livro {
  return new Livro(
    row.id,
    row.numero_registro,
    row.isbn,
    row.titulo,
    row.autor_id,
    row.data_catalogacao,
  );
}

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

export function findLivroById(id: number): Livro | null {
  const row = db.query("SELECT * FROM livros WHERE id = ?").get(id) as
    | LivroRow
    | null;

  return row === null ? null : toLivro(row);
}

export function findLivroByIsbn(isbn: string): Livro | null {
  const row = db.query("SELECT * FROM livros WHERE isbn = ?").get(isbn) as
    | LivroRow
    | null;

  return row === null ? null : toLivro(row);
}

export function findLivrosByAutorId(autorId: number): Livro[] {
  const rows = db
    .query("SELECT * FROM livros WHERE autor_id = ?")
    .all(autorId) as LivroRow[];

  return rows.map(toLivro);
}

export function insertLivro(
  numeroRegistro: string,
  isbn: string,
  titulo: string,
  autorId: number,
  dataCatalogacao: string,
): Livro {
  const result = db.run(
    `INSERT INTO livros (numero_registro, isbn, titulo, autor_id, data_catalogacao)
     VALUES (?, ?, ?, ?, ?)`,
    [numeroRegistro, isbn, titulo, autorId, dataCatalogacao],
  );

  return findLivroById(Number(result.lastInsertRowid))!;
}

export function searchLivrosPorTitulo(termo: string): Livro[] {
  const rows = db
    .query("SELECT * FROM livros WHERE titulo LIKE ?")
    .all(`%${termo}%`) as LivroRow[];

  return rows.map(toLivro);
}

// ⚠️ ainda lê a tabela do outro lado da fronteira. Fase 50.
export function searchLivrosPorNomeDoAutor(termo: string): Livro[] {
  const rows = db
    .query(
      `SELECT livros.* FROM livros
         JOIN autores ON autores.id = livros.autor_id
        WHERE autores.nome LIKE ?`,
    )
    .all(`%${termo}%`) as LivroRow[];

  return rows.map(toLivro);
}
