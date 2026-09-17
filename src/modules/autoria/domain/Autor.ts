import { InvalidValue } from "../../../shared/domain-errors";
import type { AutorId } from "../../../shared/identifiers";
import type { Orcid } from "./Orcid";

export type TipoDeAutor = "literatura" | "didatico";

export class NomeDeAutorVazio extends InvalidValue {
  constructor() {
    super("O nome do autor é obrigatório");
  }
}

export class TipoDeAutorDesconhecido extends InvalidValue {
  constructor(tipo: string) {
    super(`Tipo de autor desconhecido: ${tipo}`);
  }
}

export class Autor {
  constructor(
    readonly id: AutorId | null,
    readonly nome: string,
    readonly tipo: TipoDeAutor,
    /**
     * PROJEÇÃO, não invariante. Este número é mantido por eventos vindos do
     * Acervo e pode divergir da verdade. Nenhuma regra de negócio deste
     * módulo — nem de nenhum outro — pode decidir com base nele.
     */
    readonly livrosNoAcervo: number,
    readonly orcid: Orcid | null = null,
  ) {
    if (Autor.normalizar(nome) === "") {
      throw new NomeDeAutorVazio();
    }
  }

  /** Um autor nasce por aqui — e nasce válido. */
  static cadastrar(nome: string, tipo: string, orcid: Orcid | null): Autor {
    if (tipo !== "literatura" && tipo !== "didatico") {
      throw new TipoDeAutorDesconhecido(tipo);
    }

    return new Autor(null, nome.trim(), tipo, 0, orcid);
  }

  /** Quem atribui a identidade é a persistência; a entidade aceita sem virar mutável. */
  withId(id: AutorId): Autor {
    return new Autor(id, this.nome, this.tipo, this.livrosNoAcervo, this.orcid);
  }

  /** O que conta como "o mesmo autor" é decisão do negócio, não do SQL. */
  mesmoNomeQue(outro: string): boolean {
    return Autor.normalizar(this.nome) === Autor.normalizar(outro);
  }

  private static normalizar(nome: string): string {
    return nome.trim().toLowerCase();
  }
}