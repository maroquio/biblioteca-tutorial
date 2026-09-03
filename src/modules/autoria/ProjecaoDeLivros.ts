import type { AutorId } from "../../shared/identifiers";
import type { AutorRepository } from "./domain/AutorRepository";

/**
 * A coluna de contagem que evitamos de propósito lá na fase 04 volta aqui —
 * mas com outro dono e outro significado. Não é a verdade sobre o acervo;
 * é uma projeção que a Autoria mantém para si, alimentada por eventos.
 */
export class ProjecaoDeLivros {
  constructor(private readonly autores: AutorRepository) {}

  registrarEntrada(autorId: AutorId): void {
    this.autores.ajustarLivrosNoAcervo(autorId, +1);
  }
}
