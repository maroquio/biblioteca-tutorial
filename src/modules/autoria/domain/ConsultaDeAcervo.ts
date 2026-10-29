import type { AutorId } from "../../../shared/identifiers";

/**
 * Vocabulário do módulo Autoria. O Acervo fala em "livro", com número de
 * registro, data de catalogação e baixa; aqui nada disso interessa —
 * interessa a OBRA que o autor tem na estante.
 */
export type Obra = {
  titulo: string;
  isbn: string;
};

/** Port de saída: tudo o que a Autoria precisa saber sobre o acervo. */
export interface ConsultaDeAcervo {
  obrasDe(autorId: AutorId): Obra[];
}
