import type { Clock } from "../../../shared/Clock";

export type Reserva = {
  id: number; leitorId: number; exemplarId: number; dataReserva: string;
  dataLimiteRetirada: string; dataExpiracao: string;
  situacao: "ativa" | "cancelada" | "atendida";
};
export type Emprestimo = {
  id: number; leitorId: number; exemplarId: number; dataEmprestimo: string;
  dataPrevistaDevolucao: string; dataDevolucao: string | null;
};
export type DadosLeitor = { id: number; nome: string; cpf: string };
export type DadosExemplar = { id: number; livroTitulo: string; numeroRegistro: string };
export type Filtros = { leitorId?: number; exemplarId?: number; situacao?: string };

/** Somente as portas permitem consultar leitores e acervo. */
export interface ConsultaDeCirculacao {
  leitor(id: number): Promise<DadosLeitor | null>;
  exemplar(id: number): Promise<DadosExemplar | null>;
}

export interface RepositorioCirculacao {
  reservas(filtros?: Filtros): Promise<Reserva[]>;
  emprestimos(filtros?: Filtros): Promise<Emprestimo[]>;
  inserirReserva(dados: Omit<Reserva, "id">): Promise<Reserva>;
  situacaoReserva(id: number, situacao: "cancelada" | "atendida"): Promise<void>;
  inserirEmprestimo(dados: Omit<Emprestimo, "id">): Promise<Emprestimo>;
  devolverEmprestimo(id: number, data: string): Promise<void>;
}

/** Datas civis da biblioteca: o início/fim da janela não depende do fuso do navegador. */
export function hoje(clock: Clock = () => new Date()): string {
  return clock().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function somarDias(data: string, quantidade: number): string {
  const dia = new Date(`${data}T12:00:00Z`);
  dia.setUTCDate(dia.getUTCDate() + quantidade);
  return dia.toISOString().slice(0, 10);
}

export function situacaoReserva(reserva: Reserva, data: string): Reserva["situacao"] | "expirada" {
  return reserva.situacao === "ativa" && data >= reserva.dataExpiracao ? "expirada" : reserva.situacao;
}

export function situacaoEmprestimo(emprestimo: Emprestimo, data: string): "em_aberto" | "atrasado" | "devolvido" {
  if (emprestimo.dataDevolucao) return "devolvido";
  return data > emprestimo.dataPrevistaDevolucao ? "atrasado" : "em_aberto";
}

export function diasDeAtraso(emprestimo: Emprestimo, data: string): number {
  const fim = emprestimo.dataDevolucao ?? data;
  return Math.max(0, Math.round((Date.parse(fim) - Date.parse(emprestimo.dataPrevistaDevolucao)) / 86_400_000));
}
