/* oxlint-disable react/only-export-components -- O registro de cada UC exporta metadados e componente para o carregamento automático. */
import { Link, useSearchParams } from "react-router-dom";
import { formatarData, parametros, type Reserva } from "../api.ts";
import { Carregamento, Pagina, Situacao, Tabela, useDados } from "../components/biblioteca.tsx";
import { FiltrosCirculacao } from "../components/circulacao.tsx";

function ConsultarReservas() {
  const [params] = useSearchParams();
  const consulta = useDados<Reserva[]>(`/api/reservas${parametros({ leitorId: params.get("leitorId") ?? "", exemplarId: params.get("exemplarId") ?? "", situacao: params.get("situacao") ?? "" })}`);
  return <Pagina titulo="Consultar reservas" descricao="Confira as reservas ativas, seus prazos de retirada e o histórico de cancelamentos e atendimentos.">
    <FiltrosCirculacao situacoes={[{ valor: "ativa", nome: "Ativas" }, { valor: "cancelada", nome: "Canceladas" }, { valor: "atendida", nome: "Atendidas" }, { valor: "expirada", nome: "Expiradas" }]} />
    <Carregamento carregando={consulta.carregando} erro={consulta.erro} />
    {consulta.dados && (consulta.dados.length ? <Tabela titulo="Reservas encontradas"><thead><tr><th>Exemplar / Livro</th><th>Leitor</th><th>Reserva</th><th>Retirada até</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
      {consulta.dados.map((reserva) => <tr key={reserva.id}><td><strong>{reserva.numeroRegistro}</strong><small className="segunda-linha">{reserva.livroTitulo}</small></td><td>{reserva.leitorNome}</td><td>{formatarData(reserva.dataReserva)}</td><td>{formatarData(reserva.dataLimiteRetirada)}</td><td><Situacao valor={reserva.situacao} /></td><td>{reserva.situacao === "ativa" && <span className="acoes"><Link to={`/reservas/cancelar?id=${reserva.id}`}>Cancelar</Link><Link to={`/emprestimos/registrar?leitorId=${reserva.leitorId}&exemplarId=${reserva.exemplarId}`}>Emprestar</Link></span>}</td></tr>)}
    </tbody></Tabela> : <p className="vazio">Nenhuma reserva encontrada para esses filtros.</p>)}
  </Pagina>;
}

export default { id: "uc22", titulo: "Consultar reservas", caminho: "/reservas", Componente: ConsultarReservas };
