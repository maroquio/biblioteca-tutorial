import type { Clock } from "../../../../shared/Clock";
import { NotFound } from "../../../../shared/errors";
import { EmprestimoId } from "../../../../shared/identifiers";
import type { ConsultaDeExemplares } from "../../domain/ConsultaDeExemplares";
import type { EmprestimoRepository } from "../../domain/EmprestimoRepository";
import { emprestimoToJson, type EmprestimoJson } from "../../output";

export class DevolverLivro {
  constructor(
    private readonly emprestimos: EmprestimoRepository,
    private readonly exemplares: ConsultaDeExemplares,
    private readonly now: Clock,
  ) {}

  execute(id: number): EmprestimoJson {
    const emprestimo = this.emprestimos.findById(new EmprestimoId(id));

    if (!emprestimo) {
      throw new NotFound("Empréstimo não encontrado");
    }

    const devolvido = emprestimo.devolver(this.now());

    this.emprestimos.registrarDevolucao(devolvido);

    // o título não mora aqui: a Circulação pergunta ao Acervo toda vez
    const exemplar = this.exemplares.exemplar(devolvido.numeroRegistro);

    return emprestimoToJson(devolvido, exemplar!.titulo);
  }
}
