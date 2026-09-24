import type { Clock } from "../../../../shared/Clock";
import type { ConsultaDeAutoria } from "../../domain/ConsultaDeAutoria";
import type { EventPublisher } from "../../domain/events";
import { Livro, toIso } from "../../domain/Livro";
import type { LivroRepository } from "../../domain/LivroRepository";
import { AutorId } from "../../../../shared/identifiers";
import { Isbn } from "../../domain/Isbn";
import { LimiteDeLivros } from "../../domain/LimiteDeLivros";
import { NotFound, RuleConflict } from "../../../../shared/errors";
import type { NovoLivro } from "./input";
import { livroToJson, type LivroJson } from "../../output";

export type CorrecaoDeTitulo = {
  id: number;
  titulo: string;
};

export function parseCorrecaoDeTitulo(
  params: { id?: string },
  body: unknown,
): CorrecaoDeTitulo {
  const data = getBodyAsObject(body);
  return {
    id: getFieldAsPositiveInt(params, "id"),
    titulo: getFieldAsText(data, "titulo"),
  };
}
