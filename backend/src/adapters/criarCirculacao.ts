import type { SQL } from "bun";
import type { ConsultaDeCirculacao, RepositorioCirculacao } from "../modules/circulacao/domain/modelo";
import { CirculacaoPostgres } from "../modules/circulacao/infrastructure/CirculacaoPostgres";
import { ConsultaCirculacaoPostgres } from "./ConsultaCirculacaoPostgres";

export function dependenciasCirculacao(db: SQL): [RepositorioCirculacao, ConsultaDeCirculacao] {
  return [new CirculacaoPostgres(db), new ConsultaCirculacaoPostgres(db)];
}
