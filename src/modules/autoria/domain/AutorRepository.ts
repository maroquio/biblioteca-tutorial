import type { Autor } from "./Autor";
import type { AutorId } from "../../../shared/identifiers";

export interface AutorRepository {
  findById(autorId: AutorId): Autor | null;

  ajustarLivrosNoAcervo(autorId: AutorId, delta: number): void;
}
