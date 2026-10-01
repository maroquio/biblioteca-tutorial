import type { ConsultaDeAcervo } from "../modules/solicitacao/domain/ConsultaDeAcervo";
import type { ConsultaDeLivros } from "../modules/solicitacao/domain/ConsultaDeLivro";

export class AcervoComoConsultaDeSolicitacoes implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  existeNumeroRegistro(numeroRegistro: string): boolean {
    return this.livros.existeNumeroRegistro(numeroRegistro);
  }
}