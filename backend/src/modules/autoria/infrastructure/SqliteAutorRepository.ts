import { db } from "../../../infrastructure/db";
import { Autor, type TipoDeAutor } from "../domain/Autor";
import type { AutorRepository } from "../domain/AutorRepository";
import type { ConsultaDeAutores, ResumoDoAutor } from "../ConsultaDeAutores";
import { AutorId } from "../../../shared/identifiers";

type AutorRow = {
  id: number;
  nome: string;
  orcid: string | null;
  tipo: string;
  livros_no_acervo: number;
};

function toAutor(row: AutorRow): Autor {
  return new Autor(
    new AutorId(row.id),
    row.nome,
    row.tipo as TipoDeAutor,
    row.livros_no_acervo,
  );
}

export class SqliteAutorRepository
  implements AutorRepository, ConsultaDeAutores
{
  findById(autorId: AutorId): Autor | null {
    const row = db
      .query("SELECT * FROM autores WHERE id = ?")
      .get(autorId.value) as AutorRow | null;

    return row === null ? null : toAutor(row);
  }

  resumo(autorId: AutorId): ResumoDoAutor | null {
    const autor = this.findById(autorId);

    if (autor === null) return null;

    return {
      nome: autor.nome,
      tipo: autor.tipo,
      livrosNoAcervo: autor.livrosNoAcervo,
    };
  }

  ajustarLivrosNoAcervo(autorId: AutorId, delta: number): void {
    db.run(
      "UPDATE autores SET livros_no_acervo = livros_no_acervo + ? WHERE id = ?",
      [delta, autorId.value],
    );
  }

  idsPorNome(termo: string): AutorId[] {
    const rows = db
      .query("SELECT id FROM autores WHERE nome LIKE ?")
      .all(`%${termo}%`) as { id: number }[];

    return rows.map((row) => new AutorId(row.id));
  }
}
