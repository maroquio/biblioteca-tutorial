import type { ConsultaDeCirculacao, Emprestimo, Filtros, RepositorioCirculacao, Reserva } from "../src/modules/circulacao/domain/modelo";
import type { BaseCirculacao } from "../src/modules/circulacao/domain/BaseCirculacao";
import type { Clock } from "../src/shared/Clock";

export class MemoriaCirculacao implements RepositorioCirculacao {
  readonly reservasSalvas: Reserva[] = [];
  readonly emprestimosSalvos: Emprestimo[] = [];
  async reservas(filtros: Filtros = {}) {
    return this.reservasSalvas.filter(r => (!filtros.leitorId || r.leitorId === filtros.leitorId) && (!filtros.exemplarId || r.exemplarId === filtros.exemplarId));
  }
  async emprestimos(filtros: Filtros = {}) {
    return this.emprestimosSalvos.filter(e => (!filtros.leitorId || e.leitorId === filtros.leitorId) && (!filtros.exemplarId || e.exemplarId === filtros.exemplarId));
  }
  async inserirReserva(dados: Omit<Reserva, "id">) {
    const reserva = { ...dados, id: this.reservasSalvas.length + 1 };
    this.reservasSalvas.push(reserva); return reserva;
  }
  async situacaoReserva(id: number, situacao: "cancelada" | "atendida") { this.reservasSalvas.find(r => r.id === id)!.situacao = situacao; }
  async inserirEmprestimo(dados: Omit<Emprestimo, "id">) {
    const emprestimo = { ...dados, id: this.emprestimosSalvos.length + 1 };
    this.emprestimosSalvos.push(emprestimo); return emprestimo;
  }
  async devolverEmprestimo(id: number, data: string) { this.emprestimosSalvos.find(e => e.id === id)!.dataDevolucao = data; }
}

export function cenario() {
  const memoria = new MemoriaCirculacao();
  const tempo = { agora: "2026-10-15T12:00:00Z" };
  const consulta: ConsultaDeCirculacao = {
    leitor: async id => id <= 10 ? { id, nome: `Leitor ${id}`, cpf: "52998224725" } : null,
    exemplar: async id => id <= 20 ? { id, livroTitulo: `Livro ${id}`, numeroRegistro: `2026-${String(id).padStart(6, "0")}` } : null,
  };
  function criar<T extends BaseCirculacao>(Classe: new (r: RepositorioCirculacao, c: ConsultaDeCirculacao, clock: Clock) => T): T {
    return new Classe(memoria, consulta, () => new Date(tempo.agora));
  }
  return { memoria, tempo, criar };
}
