import type { ConsultaDeLivros } from "../modules/acervo";
import type {
  ConsultaDeExemplares,
  ExemplarConhecido,
} from "../modules/circulacao";

/**
 * Camada anticorrupção entre Acervo e Circulação: aqui — e só aqui — "o livro
 * está no acervo" vira "o exemplar pode ser emprestado".
 */
export class AcervoComoExemplares implements ConsultaDeExemplares {
  constructor(private readonly livros: ConsultaDeLivros) {}

  exemplar(numeroRegistro: string): ExemplarConhecido | null {
    const livro = this.livros.porNumeroRegistro(numeroRegistro);

    if (!livro) return null;

    return { titulo: livro.titulo, emprestavel: livro.noAcervo };
  }
}
