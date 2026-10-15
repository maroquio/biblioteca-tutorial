import type { Clock } from "../../../shared/Clock";
import { NotFound } from "../../../shared/errors";
import {
  diasDeAtraso, hoje, situacaoEmprestimo, situacaoReserva,
  type ConsultaDeCirculacao, type Emprestimo, type RepositorioCirculacao, type Reserva,
} from "./modelo";

/** Cada comando é executado pelo adaptador HTTP dentro da transação compartilhada. */
export class BaseCirculacao {
  constructor(
    protected readonly repositorio: RepositorioCirculacao,
    protected readonly consulta: ConsultaDeCirculacao,
    protected readonly clock: Clock = () => new Date(),
  ) {}

  protected async verificarVinculos(leitorId: number, exemplarId: number): Promise<void> {
    if (!await this.consulta.leitor(leitorId)) throw new NotFound("Leitor não encontrado.");
    if (!await this.consulta.exemplar(exemplarId)) throw new NotFound("Exemplar não encontrado.");
  }

  protected async detalhes(leitorId: number, exemplarId: number) {
    const [leitor, exemplar] = await Promise.all([this.consulta.leitor(leitorId), this.consulta.exemplar(exemplarId)]);
    return { leitorNome: leitor?.nome ?? "", leitorCpf: leitor?.cpf ?? "",
      livroTitulo: exemplar?.livroTitulo ?? "", numeroRegistro: exemplar?.numeroRegistro ?? "" };
  }

  protected async apresentarReserva(reserva: Reserva) {
    return { ...reserva, situacao: situacaoReserva(reserva, hoje(this.clock)),
      ...await this.detalhes(reserva.leitorId, reserva.exemplarId) };
  }

  protected async apresentarEmprestimo(emprestimo: Emprestimo) {
    const data = hoje(this.clock);
    return { ...emprestimo, situacao: situacaoEmprestimo(emprestimo, data),
      diasDeAtraso: diasDeAtraso(emprestimo, data),
      ...await this.detalhes(emprestimo.leitorId, emprestimo.exemplarId) };
  }
}
