import { db } from "../db";
import { Livro } from "../domain/Livro";
import { LivroId, AutorId } from "../domain/identifiers";
import { Isbn } from "../domain/Isbn";
import { NumeroRegistro } from "../domain/NumeroRegistro";

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
    new LivroId(row.id),
    new NumeroRegistro(row.numero_registro),
    new Isbn(row.isbn),
    row.titulo,
    new AutorId(row.autor_id),
    row.data_catalogacao,
  );
}

export function contarNoAcervoDoAutor(autorId: AutorId): number {
  const row = db
    .query("SELECT COUNT(*) AS total FROM livros WHERE autor_id = ?")
    .get(autorId.value) as { total: number };

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

export function findLivroByIsbn(isbn: Isbn): Livro | null {
  const row = db.query("SELECT * FROM livros WHERE isbn = ?").get(isbn.value) as
    | LivroRow
    | null;

  return row === null ? null : toLivro(row);
}

export function findLivrosByAutorId(autorId: AutorId): Livro[] {
  const rows = db
    .query("SELECT * FROM livros WHERE autor_id = ?")
    .all(autorId.value) as LivroRow[];

  return rows.map(toLivro);
}

export function insertLivro(livro: Livro): Livro {
  const result = db.run(
    `INSERT INTO livros (numero_registro, isbn, titulo, autor_id, data_catalogacao)
     VALUES (?, ?, ?, ?, ?)`,
    [
      livro.numeroRegistro.value,
      livro.isbn.value,
      livro.titulo,
      livro.autorId.value,
      livro.dataCatalogacao,
    ],
  );

  return livro.withId(new LivroId(Number(result.lastInsertRowid)));
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
