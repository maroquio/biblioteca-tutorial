import { getBodyAsObject, getFieldAsPositiveInt, getFieldAsText } from "../../shared/validation";
import type { Solicitacao } from "./domain/Solicitacao";

export type NovaSolicitacao = {
  numeroRegistro: string;
  matricula: string;
  diasPretendidos: number;
  observacao: string | null;
};

export function parseNovaSolicitacao(body: unknown): NovaSolicitacao {
  const data = getBodyAsObject(body);
  return {
    numeroRegistro: getFieldAsText(data, "numeroRegistro"),
    matricula: getFieldAsText(data, "matricula"),
    diasPretendidos: getFieldAsPositiveInt(data, "diasPretendidos"),
    observacao: data.observacao == null
      ? null
      : getFieldAsText(data, "observacao"),
  };
}


export type SolicitacaoJson = {
  id: number;
  numeroRegistro: string;
  matricula: string;
  diasPretendidos: number;
  observacao: string | null;
};

export function solicitacaoToJson(solicitacao: Solicitacao): SolicitacaoJson {
  return {
    id: solicitacao.id!.value,
    numeroRegistro: solicitacao.numeroRegistro,
    matricula: solicitacao.matricula,
    diasPretendidos: solicitacao.diasPretendidos,
    observacao: solicitacao.observacao,
  };
}