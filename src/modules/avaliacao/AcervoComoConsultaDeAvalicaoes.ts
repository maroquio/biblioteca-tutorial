import type { ConsultaDeLivros } from "../acervo/ConsultaDeLivros";
import type { ConsultaDeAcervo } from "./ConsultaDeAcervo";

export class AcervoComoConsultaDeAvaliacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}