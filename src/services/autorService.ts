import { db } from "../db";
import { NotFound } from "../errors";

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

export function buscarAutor(autorId: number): AutorRow {
  const autor = buscarAutorPorId(autorId);

  if (!autor) {
    throw new NotFound("Autor não cadastrado");
  }

  return autor;
}
