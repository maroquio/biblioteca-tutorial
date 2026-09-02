import { NotFound } from "../errors";
import {
  findAutorById,
  type AutorRow,
} from "../repositories/autorRepository";

export function buscarAutor(autorId: number): AutorRow {
  const autor = findAutorById(autorId);

  if (!autor) {
    throw new NotFound("Autor não cadastrado");
  }

  return autor;
}
