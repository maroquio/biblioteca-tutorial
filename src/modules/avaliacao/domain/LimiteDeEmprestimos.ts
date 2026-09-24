import { RuleViolation } from "../../../shared/domain-errors";

export class LimiteDeEmprestimosExcedido extends RuleViolation {
  constructor(limite: number) {
    super(`O leitor já tem ${limite} empréstimos em aberto`);
  }
}

/**
 * Como o LimiteDeLivros do Acervo, esta regra fala de um CONJUNTO — os
 * empréstimos em aberto de um leitor — e não cabe em nenhum empréstimo
 * sozinho. Por isso vive à parte.
 */
export class LimiteDeEmprestimos {
  static readonly MAXIMO = 3;

  static verificar(emAberto: number): void {
    if (emAberto >= LimiteDeEmprestimos.MAXIMO) {
      throw new LimiteDeEmprestimosExcedido(LimiteDeEmprestimos.MAXIMO);
    }
  }
}
