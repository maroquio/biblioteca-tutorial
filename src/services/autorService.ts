import type { Autor } from "../domain/Autor";
import type { AutorRepository } from "../domain/AutorRepository";
import type { AutorId } from "../domain/identifiers";
import { NotFound } from "../errors";

export function buscarAutor(autores: AutorRepository, autorId: AutorId): Autor {
  const autor = autores.findById(autorId);

  if (!autor) {
    throw new NotFound("Autor não cadastrado");
  }

  return autor;
}
