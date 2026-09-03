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
};

function toAutor(row: AutorRow): Autor {
  return new Autor(new AutorId(row.id), row.nome, row.tipo as TipoDeAutor);
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

    return autor === null ? null : { nome: autor.nome, tipo: autor.tipo };
  }

  idsPorNome(termo: string): AutorId[] {
    const rows = db
      .query("SELECT id FROM autores WHERE nome LIKE ?")
      .all(`%${termo}%`) as { id: number }[];

    return rows.map((row) => new AutorId(row.id));
  }
}
