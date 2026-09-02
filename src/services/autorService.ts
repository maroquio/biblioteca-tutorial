import { db } from "../db";

export type AutorRow = {
  id: number;
  nome: string;
  orcid: string | null;
  tipo: string;
};

export function buscarAutorPorId(autorId: number): AutorRow | null {
  return db
    .query("SELECT * FROM autores WHERE id = ?")
    .get(autorId) as AutorRow | null;
}
