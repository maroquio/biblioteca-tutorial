import { db } from "../db";
import type { AutorId } from "../domain/identifiers";

export type AutorRow = {
  id: number;
  nome: string;
  orcid: string | null;
  tipo: string;
};

export function findAutorById(autorId: AutorId): AutorRow | null {
  return db
    .query("SELECT * FROM autores WHERE id = ?")
    .get(autorId.value) as AutorRow | null;
}
