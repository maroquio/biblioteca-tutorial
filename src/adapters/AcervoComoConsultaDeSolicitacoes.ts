import type { ConsultaDeAcervo } from "../modules/solicitacoes/ConsultaDeAcervo";
import type { ConsultaDeLivros } from "../modules/solicitacoes/ConsultaDeLivros";

export class AcervoComoConsultaDeSolicitacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}