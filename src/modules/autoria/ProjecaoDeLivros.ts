import type { AutorId } from "../../shared/identifiers";
import type { AutorRepository } from "./domain/AutorRepository";

export class ProjecaoDeLivros {
  constructor(private readonly autores: AutorRepository) {}

  registrarEntrada(autorId: AutorId): void {
    this.autores.ajustarLivrosNoAcervo(autorId, +1);
  }
}
