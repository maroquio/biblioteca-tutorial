import type { ConsultaDeAcervo } from "./domain/ConsultaDeAcervo";
import type { ConsultaDeLivros } from "../acervo/domain/ConsultaDeLivros";

export class AcervoComoConsultaDeAvaliacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}