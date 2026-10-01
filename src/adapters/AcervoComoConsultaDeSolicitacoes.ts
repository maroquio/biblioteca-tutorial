import type { ConsultaDeLivros } from "../modules/acervo";
import type { ConsultaDeAcervo } from "../modules/solicitacoes";

export class AcervoComoConsultaDeSolicitacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}
