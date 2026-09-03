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
};

/** Port de saída: tudo o que o Acervo precisa saber sobre um autor. */
export interface ConsultaDeAutoria {
  autor(autorId: AutorId): AutorConhecido | null;
}
