import { InvalidInput, NotFound } from "../../../shared/errors";
import { type Filtros } from "./modelo";
import { BaseCirculacao } from "./BaseCirculacao";

export class ConsultarReservas extends BaseCirculacao {
  async executar(filtros: Filtros = {}) {
    if (filtros.situacao && !["ativa", "cancelada", "atendida", "expirada"].includes(filtros.situacao)) {
      throw new InvalidInput("Situação de reserva inválida.");
    }
    const resultados = await Promise.all((await this.repositorio.reservas(filtros)).map(r => this.apresentarReserva(r)));
    return resultados.filter(r => !filtros.situacao || r.situacao === filtros.situacao);
  }

  async obter(id: number) {
    const reserva = (await this.repositorio.reservas()).find(r => r.id === id);
    if (!reserva) throw new NotFound("Reserva não encontrada.");
    return this.apresentarReserva(reserva);
  }

}
