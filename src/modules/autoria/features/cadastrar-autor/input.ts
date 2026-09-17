import { getBodyAsObject, getFieldAsText } from "../../../../shared/validation";

export type NovoAutor = {
  nome: string;
  tipo: string;
  orcid: string | null;
};

export function parseNovoAutor(body: unknown): NovoAutor {
  const data = getBodyAsObject(body);

  return {
    nome: getFieldAsText(data, "nome"),
    tipo: getFieldAsText(data, "tipo"),
    orcid: data.orcid === undefined ? null : getFieldAsText(data, "orcid"),
  };
}