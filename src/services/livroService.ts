import { db } from "../db";

export type ResultadoDeLivro =
  | { ok: true; livro: unknown }
  | { ok: false; error: string; status: number };

export function cadastrarLivro(
  isbnBruto: string,
  titulo: string,
  autorId: number,
): ResultadoDeLivro {
  const isbn = isbnBruto.replace(/[^0-9]/g, "");

  const autor = db.query("SELECT * FROM autores WHERE id = ?").get(autorId) as
    | { id: number; nome: string; orcid: string | null; tipo: string }
    | null;

  if (!autor) {
    return { ok: false, error: "Autor não cadastrado", status: 404 };
  }

  const livrosDoAutor = db
    .query("SELECT COUNT(*) AS total FROM livros WHERE autor_id = ?")
    .get(autorId) as { total: number };

  const noAcervo = livrosDoAutor.total;
  const limite = autor.tipo === "didatico" ? 10 : 5;

  if (noAcervo >= limite) {
    return {
      ok: false,
      error: `O autor já tem ${limite} livros no acervo`,
      status: 409,
    };
  }

  const jaExiste = db.query("SELECT 1 FROM livros WHERE isbn = ?").get(isbn);

  if (jaExiste) {
    return { ok: false, error: "Livro já cadastrado", status: 409 };
  }

  const mesmoTitulo = db
    .query(
      "SELECT 1 FROM livros WHERE autor_id = ? AND lower(titulo) = lower(?)",
    )
    .get(autorId, titulo);

  if (mesmoTitulo) {
    return {
      ok: false,
      error: "Este autor já tem um livro com este título",
      status: 409,
    };
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

  return {
    ok: true,
    livro: { ...livro, autor: autor.nome },
  };
}
