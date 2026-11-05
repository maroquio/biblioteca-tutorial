import type { AutorId } from "../../../shared/identifiers";

export type Tiragem = "curta" | "ampla";

export type AutorConhecido = {
  nome: string;
  tiragem: Tiragem;
  livrosNoAcervo: number;
};

export interface ConsultaDeAutoria {
  autor(autorId: AutorId): AutorConhecido | null;
  idsPorNome(termo: string): AutorId[];
}
