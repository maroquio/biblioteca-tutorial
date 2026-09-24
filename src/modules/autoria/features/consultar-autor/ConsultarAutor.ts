import { NotFound } from "../../../../shared/errors";
import { AutorId } from "../../../../shared/identifiers";
import type { AutorRepository } from "../../domain/AutorRepository";
import type { ConsultaDeAcervo } from "../../domain/ConsultaDeAcervo";
import { autorComObrasToJson, type AutorComObrasJson } from "../../output";

export class ConsultarAutor {
  constructor(
    private readonly autores: AutorRepository,
    private readonly acervo: ConsultaDeAcervo,
  ) {}

  execute(id: number): AutorComObrasJson {
    const autorId = new AutorId(id);

    const autor = this.autores.findById(autorId);

    if (!autor) {
      throw new NotFound("Autor não encontrado");
    }

    // o autor é dado desta casa; as obras, o Acervo é quem sabe
    return autorComObrasToJson(autor, this.acervo.obrasDe(autorId));
  }
}
