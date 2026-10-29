import type { Clock } from "../../../../shared/Clock";
import { NotFound, RuleConflict } from "../../../../shared/errors";
import type { ConsultaDeExemplares } from "../../domain/ConsultaDeExemplares";
import { Emprestimo } from "../../domain/Emprestimo";
import type { EmprestimoRepository } from "../../domain/EmprestimoRepository";
import { LimiteDeEmprestimos } from "../../domain/LimiteDeEmprestimos";
import { emprestimoToJson, type EmprestimoJson } from "../../output";
import type { NovoEmprestimo } from "./input";

export class EmprestarLivro {
  constructor(
    private readonly emprestimos: EmprestimoRepository,
    private readonly exemplares: ConsultaDeExemplares,
    private readonly now: Clock,
  ) {}

  execute(input: NovoEmprestimo): EmprestimoJson {
    const exemplar = this.exemplares.exemplar(input.numeroRegistro);

    if (!exemplar) {
      throw new NotFound("Exemplar não encontrado");
    }

    if (!exemplar.emprestavel) {
      throw new RuleConflict("Este exemplar não está mais no acervo");
    }

    const emprestado = this.emprestimos
      .doExemplar(input.numeroRegistro)
      .some((emprestimo) => emprestimo.estaEmAberto());

    if (emprestado) {
      throw new RuleConflict("Este exemplar já está emprestado");
    }

    LimiteDeEmprestimos.verificar(
      this.emprestimos
        .doLeitor(input.matricula)
        .filter((emprestimo) => emprestimo.estaEmAberto()).length,
    );

    const emprestimo = this.emprestimos.insert(
      Emprestimo.abrir(input.numeroRegistro, input.matricula, this.now()),
    );

    return emprestimoToJson(emprestimo, exemplar.titulo);
  }
}
