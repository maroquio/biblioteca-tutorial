import { getBodyAsObject, getFieldAsText } from "../../../../shared/validation";

export type NovoEmprestimo = {
  numeroRegistro: string;
  matricula: string;
};

export function parseNovoEmprestimo(body: unknown): NovoEmprestimo {
  const data = getBodyAsObject(body);

  return {
    numeroRegistro: getFieldAsText(data, "numeroRegistro"),
    matricula: getFieldAsText(data, "matricula"),
  };
}
