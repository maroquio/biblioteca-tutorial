import { InvalidValue } from "../../../shared/domain-errors";
import { toIso } from "./Livro";

export type MotivoDeBaixa = "extravio" | "dano" | "doacao";

const MOTIVOS: readonly string[] = ["extravio", "dano", "doacao"];

export class MotivoDeBaixaDesconhecido extends InvalidValue {
  constructor(motivo: string) {
    super(`Motivo de baixa desconhecido: ${motivo}`);
  }
}

/**
 * Motivo e data andam juntos: não existe baixa sem um dos dois. Por isso são
 * um único value object, e não duas colunas soltas que podem ficar meio
 * preenchidas.
 */
export class Baixa {
  constructor(
    readonly motivo: MotivoDeBaixa,
    readonly em: string,
  ) {}

  /** A baixa nasce por aqui — com um motivo do vocabulário e a data de hoje. */
  static registrar(motivo: string, hoje: Date): Baixa {
    if (!MOTIVOS.includes(motivo)) {
      throw new MotivoDeBaixaDesconhecido(motivo);
    }

    return new Baixa(motivo as MotivoDeBaixa, toIso(hoje));
  }
}