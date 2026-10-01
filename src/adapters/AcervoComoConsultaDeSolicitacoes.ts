import type { ConsultaDeLivros } from "../modules/solicitacoes/ConsultaDeLivros";
import type { ConsultaDeAcervo } from "../modules/solicitacoes/ConsultaDeAcervo";

export class AcervoComoConsultaDeSolicitacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}