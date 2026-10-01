import type { AutorConhecido, ConsultaDeAutoria } from "../modules/acervo";
import type { ConsultaDeAutores } from "../modules/autoria";
import type { AutorId } from "../shared/identifiers";

export class AutoriaComoConsulta implements ConsultaDeAutoria {
  constructor(private readonly autores: ConsultaDeAutores) {}

  autor(autorId: AutorId): AutorConhecido | null {
    const resumo = this.autores.resumo(autorId);

    if (!resumo) return null;

    return {
      nome: resumo.nome,
      tiragem: resumo.tipo === "didatico" ? "ampla" : "curta",
      livrosNoAcervo: resumo.livrosNoAcervo,
    };
  }

  idsPorNome(termo: string): AutorId[] {
    return this.autores.idsPorNome(termo);
  }
}
