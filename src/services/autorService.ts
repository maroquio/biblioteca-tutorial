import type { AutorId } from "../domain/identifiers";
import { NotFound } from "../errors";
import {
  findAutorById,
  type AutorRow,
} from "../repositories/autorRepository";

export function buscarAutor(autorId: AutorId): AutorRow {
  const autor = findAutorById(autorId);

  if (!autor) {
    throw new NotFound("Autor não cadastrado");
  }

  return autor;
}
