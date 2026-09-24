import type { ConsultaDeAcervo } from "../modules/avaliacoes/ConsultaDeAcervo";

export class AcervoComoConsultaDeAvaliacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeAcervo) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}