import { Autor } from "../../domain/Autor";
import type { AutorRepository } from "../../domain/AutorRepository";
import { Orcid } from "../../domain/Orcid";
import { RuleConflict } from "../../../../shared/errors";
import type { NovoAutor } from "./input";
import { autorToJson, type AutorJson } from "../../output";

export class CadastrarAutor {
  constructor(private readonly autores: AutorRepository) {}

  execute(input: NovoAutor): AutorJson {
    const orcid = input.orcid === null ? null : new Orcid(input.orcid);

    if (orcid !== null && this.autores.findByOrcid(orcid)) {
      throw new RuleConflict("Autor já cadastrado com este ORCID");
    }

    const homonimo = this.autores
      .findByNomeSemelhante(input.nome)
      .some((autor) => autor.mesmoNomeQue(input.nome));

    if (homonimo) {
      throw new RuleConflict("Já existe um autor com este nome");
    }

    const autor = this.autores.insert(
      Autor.cadastrar(input.nome, input.tipo, orcid),
    );

    return autorToJson(autor);
  }
}