/**
 * Vocabulário do módulo Circulação. Para quem empresta, um livro é um
 * EXEMPLAR na prateleira: tem um título para mostrar e pode ou não sair.
 * Baixa, ISBN e data de catalogação são assunto do Acervo.
 */
export type ExemplarConhecido = {
  titulo: string;
  emprestavel: boolean;
};

/** Port de saída: tudo o que a Circulação precisa saber sobre o acervo. */
export interface ConsultaDeExemplares {
  exemplar(numeroRegistro: string): ExemplarConhecido | null;
}
