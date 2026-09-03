import type { TipoDeAutor } from "../../autoria";
import { RuleViolation } from "../../../shared/domain-errors";

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
  private static readonly POR_TIPO: Record<TipoDeAutor, number> = {
    literatura: 5,
    didatico: 10,
  };

  static para(tipo: TipoDeAutor): number {
    return LimiteDeLivros.POR_TIPO[tipo];
  }

  static verificar(tipo: TipoDeAutor, noAcervo: number): void {
    const limite = LimiteDeLivros.para(tipo);

    if (noAcervo >= limite) {
      throw new LimiteDeLivrosExcedido(limite);
    }
  }
}
