import type { ConsultaDeAcervo } from "./modules/acervo/ConsultaDeAcervo";
import type { ConsultaDeLivros } from "./modules/acervo/ConsultaDeLivros";

export class AcervoComoConsultaDeSolicitacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}