import type { AvaliacaoRepository } from "../../domain/AvaliacaoRepository";
import type { ConsultaDeAcervo } from "../../domain/ConsultaDeAcervo";
import type { NovaAvaliacao } from "./input";
import type { AvaliacaoJson } from "../../output";
import { Avaliacao } from "../../domain/Avaliacao";
import { avaliacaoToJson } from "../../output";
import { NotFound } from "../../../../shared/errors";
import { RuleConflict } from "../../../../shared/errors";


export class RegistrarAvaliacao {
  constructor(
    private readonly avaliacoes: AvaliacaoRepository,
    private readonly acervo: ConsultaDeAcervo,
  ) {}

  execute(input: NovaAvaliacao): AvaliacaoJson {
    if (!this.acervo.existeNumeroRegistro(input.numeroRegistro)) {
      throw new NotFound("Livro não encontrado");
    }
    if (this.avaliacoes.findByMatriculaELivro(
      input.matricula, input.numeroRegistro,
    )) {
      throw new RuleConflict("Leitor já avaliou este livro");
    }

    const avaliacao = this.avaliacoes.insert(Avaliacao.registrar(
      input.numeroRegistro,
      input.matricula,
      input.nota,
      input.comentario,
    ));
    return avaliacaoToJson(avaliacao);
  }
}