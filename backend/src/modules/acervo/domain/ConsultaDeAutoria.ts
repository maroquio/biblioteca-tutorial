import type { AutorId } from "../../../shared/identifiers";

/**
 * Vocabulário do módulo Acervo. A Autoria fala em "literatura" e "didatico";
 * aqui isso não interessa — interessa que TIRAGEM o autor admite. A tradução
 * acontece no adaptador, na fronteira.
 */
export type Tiragem = "curta" | "ampla";

export type AutorConhecido = {
  nome: string;
  tiragem: Tiragem;
  /** Cópia local da verdade, mantida pela Autoria. Serve para mostrar, não para decidir. */
  livrosNoAcervo: number;
};

/** Port de saída: tudo o que o Acervo precisa saber sobre um autor. */
export interface ConsultaDeAutoria {
  autor(autorId: AutorId): AutorConhecido | null;
  idsPorNome(termo: string): AutorId[];
}
