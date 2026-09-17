import { db } from "../../../infrastructure/db";
import { LivroId, AutorId } from "../../../shared/identifiers";
import { Baixa, type MotivoDeBaixa } from "../domain/Baixa";
import { Isbn } from "../domain/Isbn";
import { Livro } from "../domain/Livro";
import type { LivroRepository } from "../domain/LivroRepository";
import { NumeroRegistro } from "../domain/NumeroRegistro";

type LivroRow = {
  id: number;
  numero_registro: string;
  isbn: string;
  titulo: string;
  autor_id: number;
  data_catalogacao: string;
  baixa_motivo: string | null;
  baixa_em: string | null;
};

function toLivro(row: LivroRow): Livro {
  return new Livro(
    new LivroId(row.id),
    new NumeroRegistro(row.numero_registro),
    new Isbn(row.isbn),
    row.titulo,
    new AutorId(row.autor_id),
    row.data_catalogacao,
    row.baixa_em === null
      ? null
      : new Baixa(row.baixa_motivo as MotivoDeBaixa, row.baixa_em),
  );
}

export class SqliteLivroRepository implements LivroRepository {
  contarCatalogadosNoAno(ano: string): number {
    const row = db
      .query(
        `SELECT COUNT(*) AS total FROM livros
          WHERE data_catalogacao LIKE ?`,
      )
      .get(`${ano}%`) as { total: number };

    return row.total;
  }

  insert(livro: Livro): Livro {
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

  findByIsbn(isbn: Isbn): Livro | null {
    const row = db
      .query("SELECT * FROM livros WHERE isbn = ?")
      .get(isbn.value) as LivroRow | null;

    return row === null ? null : toLivro(row);
  }

  findByNumeroRegistro(numero: NumeroRegistro): Livro | null {
    const row = db
      .query("SELECT * FROM livros WHERE numero_registro = ?")
      .get(numero.value) as LivroRow | null;

    return row === null ? null : toLivro(row);
  }

  findByAutorId(autorId: AutorId): Livro[] {
    const rows = db
      .query("SELECT * FROM livros WHERE autor_id = ?")
      .all(autorId.value) as LivroRow[];

    return rows.map(toLivro);
  }

  searchByTitulo(termo: string): Livro[] {
    const rows = db
      .query("SELECT * FROM livros WHERE titulo LIKE ?")
      .all(`%${termo}%`) as LivroRow[];

    return rows.map(toLivro);
  }

  findByAutorIds(autorIds: AutorId[]): Livro[] {
    if (autorIds.length === 0) return [];

    const placeholders = autorIds.map(() => "?").join(", ");
    const rows = db
      .query(`SELECT * FROM livros WHERE autor_id IN (${placeholders})`)
      .all(...autorIds.map((autorId) => autorId.value)) as LivroRow[];

    return rows.map(toLivro);
  }

  registrarBaixa(livro: Livro): void {
    db.run("UPDATE livros SET baixa_motivo = ?, baixa_em = ? WHERE id = ?", [
      livro.baixa!.motivo,
      livro.baixa!.em,
      livro.id!.value,
    ]);
  }
}