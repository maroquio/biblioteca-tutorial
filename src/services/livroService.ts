import { db } from "../db";
import { RuleConflict } from "../errors";
import { buscarAutor } from "./autorService";

export type LivroRow = {
  id: number;
  numero_registro: string;
  isbn: string;
  titulo: string;
  autor_id: number;
  data_catalogacao: string;
};

export function cadastrarLivro(
  isbnBruto: string,
  titulo: string,
  autorId: number,
): unknown {
  const isbn = isbnBruto.replace(/[^0-9]/g, "");

  const autor = buscarAutor(autorId);

  const livrosDoAutor = db
    .query("SELECT COUNT(*) AS total FROM livros WHERE autor_id = ?")
    .get(autorId) as { total: number };

  const noAcervo = livrosDoAutor.total;
  const limite = autor.tipo === "didatico" ? 10 : 5;

  if (noAcervo >= limite) {
    throw new RuleConflict(`O autor já tem ${limite} livros no acervo`);
  }

  const jaExiste = db.query("SELECT 1 FROM livros WHERE isbn = ?").get(isbn);

  if (jaExiste) {
    throw new RuleConflict("Livro já cadastrado");
  }

  const mesmoTitulo = db
    .query(
      "SELECT 1 FROM livros WHERE autor_id = ? AND lower(titulo) = lower(?)",
    )
    .get(autorId, titulo);

  if (mesmoTitulo) {
    throw new RuleConflict("Este autor já tem um livro com este título");
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const ano = hoje.slice(0, 4);

  const catalogadosNoAno = db
    .query(
      `SELECT COUNT(*) AS total FROM livros
        WHERE data_catalogacao LIKE ?`,
    )
    .get(`${ano}%`) as { total: number };

  const numeroRegistro = `${ano}-${String(catalogadosNoAno.total + 1).padStart(6, "0")}`;

  const result = db.run(
    `INSERT INTO livros (numero_registro, isbn, titulo, autor_id, data_catalogacao)
     VALUES (?, ?, ?, ?, ?)`,
    [numeroRegistro, isbn, titulo, autorId, hoje],
  );

  const livro = db
    .query("SELECT * FROM livros WHERE id = ?")
    .get(Number(result.lastInsertRowid)) as Record<string, unknown>;

  return { ...livro, autor: autor.nome };
}

export function buscarLivros(q: string): LivroRow[] {
  const porIsbn = db
    .query("SELECT * FROM livros WHERE isbn = ?")
    .all(q) as LivroRow[];

  if (porIsbn.length > 0) return porIsbn;

  const porTitulo = db
    .query("SELECT * FROM livros WHERE titulo LIKE ?")
    .all(`%${q}%`) as LivroRow[];

  if (porTitulo.length > 0) return porTitulo;

  // ⚠️ este JOIN lê a tabela do outro lado da fronteira. Fase 50.
  return db
    .query(
      `SELECT livros.* FROM livros
         JOIN autores ON autores.id = livros.autor_id
        WHERE autores.nome LIKE ?`,
    )
    .all(`%${q}%`) as LivroRow[];
}
