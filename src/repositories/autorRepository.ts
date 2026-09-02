import { db } from "../db";
import { Autor, type TipoDeAutor } from "../domain/Autor";
import { AutorId } from "../domain/identifiers";

type AutorRow = {
  id: number;
  nome: string;
  orcid: string | null;
  tipo: string;
};

function toAutor(row: AutorRow): Autor {
  return new Autor(new AutorId(row.id), row.nome, row.tipo as TipoDeAutor);
}

export function findAutorById(autorId: AutorId): Autor | null {
  const row = db
    .query("SELECT * FROM autores WHERE id = ?")
    .get(autorId.value) as AutorRow | null;

  return row === null ? null : toAutor(row);
}
