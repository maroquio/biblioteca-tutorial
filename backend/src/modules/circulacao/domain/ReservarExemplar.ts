import { RuleConflict } from "../../../shared/errors";
import { hoje, situacaoReserva, somarDias } from "./modelo";
import { BaseCirculacao } from "./BaseCirculacao";

export class ReservarExemplar extends BaseCirculacao {
  async executar(leitorId: number, exemplarId: number) {
    await this.verificarVinculos(leitorId, exemplarId);
    const data = hoje(this.clock);
    const reservasLeitor = await this.repositorio.reservas({ leitorId });
    if (reservasLeitor.filter(r => situacaoReserva(r, data) === "ativa").length >= 2) {
      throw new RuleConflict("O leitor já possui duas reservas ativas.");
    }
    const reservasExemplar = await this.repositorio.reservas({ exemplarId });
    const emprestimosExemplar = await this.repositorio.emprestimos({ exemplarId });
    if (reservasExemplar.some(r => situacaoReserva(r, data) === "ativa") || emprestimosExemplar.some(e => !e.dataDevolucao)) {
      throw new RuleConflict("Exemplar indisponível para reserva.");
    }
    const reserva = await this.repositorio.inserirReserva({ leitorId, exemplarId, dataReserva: data,
      dataLimiteRetirada: somarDias(data, 6), dataExpiracao: somarDias(data, 7), situacao: "ativa" });
    return this.apresentarReserva(reserva);
  }

}
