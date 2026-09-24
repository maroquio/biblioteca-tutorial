import type { AvaliacaoId } from "../../../shared/identifiers";
import type { Avaliacao } from "./Avaliacao";

export interface AvaliacaoRepository {
  findByMatriculaELivro(
    matricula: string,
    numeroRegistro: string,
  ): Avaliacao | null;
  insert(avaliacao: Avaliacao): Avaliacao;
}