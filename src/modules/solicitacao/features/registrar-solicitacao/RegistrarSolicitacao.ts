import { NotFound, RuleConflict } from "../../../../shared/errors";
import type { ConsultaDeAcervo } from "../../domain/ConsultaDeAcervo";
import { Solicitacao } from "../../domain/Solicitacao";
import type { SolicitacaoRepository } from "../../domain/SolicitacaoRepository";
import { solicitacaoToJson, type SolicitacaoJson } from "../../output";
import type { NovaSolicitacao } from "./input";

export class RegistrarSolicitacao {
  constructor(
    private readonly solicitacao: SolicitacaoRepository,
    private readonly acervo: ConsultaDeAcervo,
  ) {}

  execute(input: NovaSolicitacao): SolicitacaoJson {
    if (!this.acervo.existeNumeroRegistro(input.numeroRegistro)) {
      throw new NotFound("Livro não encontrado");
    }
    if (this.solicitacao.findByMatriculaELivro(
      input.matricula, input.numeroRegistro,
    )) {
      throw new RuleConflict("Leitor já solicitou este livro");
    }

    const solicitacao = this.solicitacao.insert(Solicitacao.registrar(
      input.numeroRegistro,
      input.matricula,
      input.diasPretendidos,
      input.observacao,
    ));
    return solicitacaoToJson(solicitacao);
  }
}
