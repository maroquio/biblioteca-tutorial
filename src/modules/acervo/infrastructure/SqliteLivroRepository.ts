import { db } from "../../../infrastructure/db";
import { LivroId, AutorId } from "../../../shared/identifiers";
import type { ConsultaDeLivros, ResumoDoLivro } from "../ConsultaDeLivros";
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

function toResumo(livro: Livro): ResumoDoLivro {
  return {
    numeroRegistro: livro.numeroRegistro.value,
    isbn: livro.isbn.value,
    titulo: livro.titulo,
    noAcervo: livro.estaNoAcervo(),
  };
}

export class SqliteLivroRepository
  implements LivroRepository, ConsultaDeLivros
{
  existeNumeroRegistro(numeroRegistro: string): boolean {
    return db.query("SELECT 1 FROM livros WHERE numero_registro = ?")
      .get(numeroRegistro) !== null;
  }
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

  noAcervoDoAutor(autorId: AutorId): ResumoDoLivro[] {
    return this.findByAutorId(autorId)
      .filter((livro) => livro.estaNoAcervo())
      .map(toResumo);
  }

  porNumeroRegistro(numero: string): ResumoDoLivro | null {
    const livro = this.findByNumeroRegistro(new NumeroRegistro(numero));

    return livro === null ? null : toResumo(livro);
  }

  registrarBaixa(livro: Livro): void {
    db.run("UPDATE livros SET baixa_motivo = ?, baixa_em = ? WHERE id = ?", [
      livro.baixa!.motivo,
      livro.baixa!.em,
      livro.id!.value,
    ]);
  }

  findById(id: LivroId): Livro | null {
    const row = db.query("SELECT * FROM livros WHERE id = ?")
      .get(id.value) as LivroRow | null;
    return row === null ? null : toLivro(row);
  }

  updateTitulo(livro: Livro): void {
    db.run("UPDATE livros SET titulo = ? WHERE id = ?", [
      livro.titulo,
      livro.id!.value,
    ]);
  }
}
