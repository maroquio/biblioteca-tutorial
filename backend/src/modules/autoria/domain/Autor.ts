import type { AutorId } from "../../../shared/identifiers";

export type TipoDeAutor = "literatura" | "didatico";

export class Autor {
  constructor(
    readonly id: AutorId,
    readonly nome: string,
    readonly tipo: TipoDeAutor,
    /**
     * PROJEÇÃO, não invariante. Este número é mantido por eventos vindos do
     * Acervo e pode divergir da verdade. Nenhuma regra de negócio deste
     * módulo — nem de nenhum outro — pode decidir com base nele.
     */
    readonly livrosNoAcervo: number,
  ) {}
}
