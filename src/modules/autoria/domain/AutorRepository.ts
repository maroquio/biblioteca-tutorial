import type { Autor } from "./Autor";
import type { AutorId } from "../../../shared/identifiers";

export interface AutorRepository {
  findById(autorId: AutorId): Autor | null;

  /** Escrita da projeção. Só a própria Autoria chama isto. */
  ajustarLivrosNoAcervo(autorId: AutorId, delta: number): void;
}
