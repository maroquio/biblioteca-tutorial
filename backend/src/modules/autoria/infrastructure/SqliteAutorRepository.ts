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
  async findById(autorId: AutorId): Promise<Autor | null> {
    const row = db
      .query("SELECT * FROM autores WHERE id = ?")
      .get(autorId.value) as AutorRow | null;

    return row === null ? null : toAutor(row);
  }

  async resumo(autorId: AutorId): Promise<ResumoDoAutor | null> {
    const autor = await this.findById(autorId);

    if (autor === null) return null;

    return {
      nome: autor.nome,
      tipo: autor.tipo,
      livrosNoAcervo: autor.livrosNoAcervo,
    };
  }

  async ajustarLivrosNoAcervo(autorId: AutorId, delta: number): Promise<void> {
    db.run(
      "UPDATE autores SET livros_no_acervo = livros_no_acervo + ? WHERE id = ?",
      [delta, autorId.value],
    );
  }

  async idsPorNome(termo: string): Promise<AutorId[]> {
    const rows = db
      .query("SELECT id FROM autores WHERE nome LIKE ?")
      .all(`%${termo}%`) as { id: number }[];

    return rows.map((row) => new AutorId(row.id));
  }
}
