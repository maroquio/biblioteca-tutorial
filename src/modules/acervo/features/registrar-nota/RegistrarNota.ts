import { NotFound, RuleConflict } from "../../../../shared/errors";
import type { AvaliacaoRepository } from "../../domain/AvaliacaoRepository";
import type { ConsultaDeAcervo } from "../../domain/ConsultaDeAcervo";
import { Avaliacao } from "../../domain/NotaLivro";
import type { NovaAvaliacao } from "./input";
import { avaliacaoToJson, type AvaliacaoJson } from "./output";

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