import { RuleViolation } from "../../../shared/domain-errors";
import type { Tiragem } from "./ConsultaDeAutoria";

export class LimiteDeLivrosExcedido extends RuleViolation {
  constructor(limite: number) {
    super(`O autor já tem ${limite} livros no acervo`);
  }
}

/**
 * Esta regra não cabe em nenhuma instância de Livro: ela fala do CONJUNTO
 * de livros de um autor. Também não cabe em Autor, que não conhece — nem
 * deve conhecer — os livros dele. Por isso vive sozinha.
 */
export class LimiteDeLivros {
  private static readonly POR_TIRAGEM: Record<Tiragem, number> = {
    curta: 5,
    ampla: 10,
  };

  static para(tiragem: Tiragem): number {
    return LimiteDeLivros.POR_TIRAGEM[tiragem];
  }

  static verificar(tiragem: Tiragem, noAcervo: number): void {
    const limite = LimiteDeLivros.para(tiragem);

    if (noAcervo >= limite) {
      throw new LimiteDeLivrosExcedido(limite);
    }
  }
}
