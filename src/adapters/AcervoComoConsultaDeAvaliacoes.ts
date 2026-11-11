import type { ConsultaDeAcervo } from "../modules/acervo/domain/ConsultaDeAcervo";
import type { ConsultaDeLivros } from "../modules/acervo/domain/ConsultaDeLivros";

export class AcervoComoConsultaDeAvaliacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}