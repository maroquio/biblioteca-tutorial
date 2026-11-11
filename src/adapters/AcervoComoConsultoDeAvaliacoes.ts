import type { ConsultaDeLivros } from "../modules/acervo/ConsultaDeLivros";
import type { ConsultaDeAcervo } from "../modules/avaliacao/domain/ConsultaDeAcervo";

export class AcervoComoConsultaDeAvaliacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}