import type { Autor } from "../domain/Autor";
import type { AutorId } from "../domain/identifiers";
import { NotFound } from "../errors";
import { findAutorById } from "../repositories/autorRepository";

export function buscarAutor(autorId: AutorId): Autor {
  const autor = findAutorById(autorId);

  if (!autor) {
    throw new NotFound("Autor não cadastrado");
  }

  return autor;
}
