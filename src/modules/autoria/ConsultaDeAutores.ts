import type { AutorId } from "../../shared/identifiers";
import type { TipoDeAutor } from "./domain/Autor";

export type ResumoDoAutor = {
  nome: string;
  tipo: TipoDeAutor;
  livrosNoAcervo: number;
};

/** Contrato de leitura publicado pela Autoria, no vocabulário da Autoria. */
export interface ConsultaDeAutores {
  resumo(autorId: AutorId): ResumoDoAutor | null;
  idsPorNome(termo: string): AutorId[];
}
