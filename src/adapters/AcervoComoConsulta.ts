import type { ConsultaDeLivros } from "../modules/acervo";
import type { ConsultaDeAcervo, Obra } from "../modules/autoria";
import type { AutorId } from "../shared/identifiers";

/**
 * Camada anticorrupção, agora no sentido contrário ao da fase 49: aqui — e só
 * aqui — o "livro" do Acervo vira a "obra" da Autoria. O número de registro
 * fica para trás: é assunto do Acervo.
 */
export class AcervoComoConsulta implements ConsultaDeAcervo {
  constructor(private readonly livros: ConsultaDeLivros) {}

  obrasDe(autorId: AutorId): Obra[] {
    return this.livros
      .noAcervoDoAutor(autorId)
      .map((livro) => ({ titulo: livro.titulo, isbn: livro.isbn }));
  }
}

