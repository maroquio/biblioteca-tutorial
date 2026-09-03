import type { AutorId } from "../../../shared/identifiers";

export type TipoDeAutor = "literatura" | "didatico";

export class Autor {
  constructor(
    readonly id: AutorId,
    readonly nome: string,
    readonly tipo: TipoDeAutor,
  ) {}
}
