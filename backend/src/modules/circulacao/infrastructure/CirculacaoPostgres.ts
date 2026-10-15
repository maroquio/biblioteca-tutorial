import type { SQL } from "bun";
import type { Emprestimo, Filtros, RepositorioCirculacao, Reserva } from "../domain/modelo";

export class CirculacaoPostgres implements RepositorioCirculacao {
  constructor(private readonly db: SQL) {}

  async reservas(filtros: Filtros = {}): Promise<Reserva[]> {
    return await this.db<Reserva[]>`SELECT id, leitor_id AS "leitorId", exemplar_id AS "exemplarId",
      data_reserva AS "dataReserva", data_limite_retirada AS "dataLimiteRetirada",
      data_expiracao AS "dataExpiracao", situacao FROM reservas
      WHERE (${filtros.leitorId ?? null}::INTEGER IS NULL OR leitor_id = ${filtros.leitorId ?? null})
        AND (${filtros.exemplarId ?? null}::INTEGER IS NULL OR exemplar_id = ${filtros.exemplarId ?? null})
      ORDER BY id DESC`;
  }

  async emprestimos(filtros: Filtros = {}): Promise<Emprestimo[]> {
    return await this.db<Emprestimo[]>`SELECT id, leitor_id AS "leitorId", exemplar_id AS "exemplarId",
      data_emprestimo AS "dataEmprestimo", data_prevista_devolucao AS "dataPrevistaDevolucao",
      data_devolucao AS "dataDevolucao" FROM emprestimos
      WHERE (${filtros.leitorId ?? null}::INTEGER IS NULL OR leitor_id = ${filtros.leitorId ?? null})
        AND (${filtros.exemplarId ?? null}::INTEGER IS NULL OR exemplar_id = ${filtros.exemplarId ?? null})
      ORDER BY id DESC`;
  }

  async inserirReserva(dados: Omit<Reserva, "id">): Promise<Reserva> {
    const [row] = await this.db`INSERT INTO reservas
      (leitor_id, exemplar_id, data_reserva, data_limite_retirada, data_expiracao, situacao)
      VALUES (${dados.leitorId}, ${dados.exemplarId}, ${dados.dataReserva}, ${dados.dataLimiteRetirada}, ${dados.dataExpiracao}, ${dados.situacao})
      RETURNING id`;
    return { ...dados, id: Number(row!.id) };
  }

  async situacaoReserva(id: number, situacao: "cancelada" | "atendida"): Promise<void> {
    await this.db`UPDATE reservas SET situacao = ${situacao} WHERE id = ${id}`;
  }

  async inserirEmprestimo(dados: Omit<Emprestimo, "id">): Promise<Emprestimo> {
    const [row] = await this.db`INSERT INTO emprestimos
      (leitor_id, exemplar_id, data_emprestimo, data_prevista_devolucao, data_devolucao)
      VALUES (${dados.leitorId}, ${dados.exemplarId}, ${dados.dataEmprestimo}, ${dados.dataPrevistaDevolucao}, ${dados.dataDevolucao})
      RETURNING id`;
    return { ...dados, id: Number(row!.id) };
  }

  async devolverEmprestimo(id: number, data: string): Promise<void> {
    await this.db`UPDATE emprestimos SET data_devolucao = ${data} WHERE id = ${id}`;
  }
}
