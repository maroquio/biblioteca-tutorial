import type { ConsultaDeLivros } from "../modules/acervo";
import type { ConsultaDeAcervo, Obra } from "../modules/autoria";
import type { AutorId } from "../shared/identifiers";

export class AcervoComoConsultaDeAvaliacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}
    obrasDe(autorId: AutorId): Obra[] {
        throw new Error("Method not implemented.");
    }

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}