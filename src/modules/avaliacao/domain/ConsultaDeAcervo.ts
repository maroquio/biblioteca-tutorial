/**
 * Vocabulário do módulo Circulação. Para quem empresta, um livro é um
 * EXEMPLAR na prateleira: tem um título para mostrar e pode ou não sair.
 * Baixa, ISBN e data de catalogação são assunto do Acervo.
 */

export interface ConsultaDeAcervo {
  existeNumeroRegistro(numeroRegistro: string): boolean;
}