/* oxlint-disable react/only-export-components -- O registro de cada UC exporta metadados e componente para o carregamento automático. */
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { enviar, formatarCpf, formatarData, type Exemplar, type Leitor, type Reserva } from "../api.ts";
import { Avisos, Carregamento, Pagina, Seletor, useDados } from "../components/biblioteca.tsx";

function ReservarExemplar() {
  const [params] = useSearchParams();
  const [revisao, setRevisao] = useState(0);
  const leitores = useDados<Leitor[]>("/api/leitores");
  const exemplares = useDados<Exemplar[]>("/api/exemplares?situacao=disponivel", revisao);
  const [erro, setErro] = useState("");
  const [salvo, setSalvo] = useState<Reserva | null>(null);
  const [enviando, setEnviando] = useState(false);
  async function reservar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const formulario = evento.currentTarget;
    const dados = new FormData(formulario);
    setEnviando(true); setErro(""); setSalvo(null);
    try {
      setSalvo(await enviar<Reserva>("/api/reservas", "POST", { leitorId: Number(dados.get("leitorId")), exemplarId: Number(dados.get("exemplarId")) }));
      formulario.reset(); setRevisao((valor) => valor + 1);
    } catch (e) { setErro((e as Error).message); }
    finally { setEnviando(false); }
  }
  return <Pagina titulo="Reservar exemplar" descricao="Separe uma cópia disponível para retirada pelo leitor durante 7 dias corridos, a partir de hoje.">
    <Carregamento carregando={leitores.carregando || exemplares.carregando} erro={leitores.erro || exemplares.erro} />
    {leitores.dados && exemplares.dados && (leitores.dados.length && exemplares.dados.length ? <form className="cadastro" onSubmit={reservar} key={revisao}>
      <Seletor nome="leitorId" titulo="Leitor" itens={leitores.dados} rotulo={(leitor) => `${leitor.nome} · ${formatarCpf(leitor.cpf)}`} />
      <Seletor nome="exemplarId" titulo="Exemplar disponível" itens={exemplares.dados} rotulo={(exemplar) => `${exemplar.numeroRegistro} · ${exemplar.titulo}`} padrao={revisao === 0 ? params.get("exemplarId") ?? "" : ""} />
      <p className="nota">Cada leitor pode manter até duas reservas ativas. O exemplar fica bloqueado imediatamente e a reserva expira se não houver retirada no prazo.</p>
      <button type="submit" disabled={enviando}>{enviando ? "Reservando…" : "Confirmar reserva"}</button>
    </form> : <p className="vazio">{!leitores.dados.length ? "Cadastre um leitor para reservar um exemplar." : "Não há exemplares disponíveis para reserva."}</p>)}
    <Avisos erro={erro} />
    {salvo && <div className="sucesso" role="status"><p>Reserva confirmada para <strong>{salvo.leitorNome}</strong>: {salvo.numeroRegistro} · {salvo.livroTitulo}.</p><p>Retirada de {formatarData(salvo.dataReserva)} até <strong>{formatarData(salvo.dataLimiteRetirada)}</strong>.</p><Link to={`/reservas?leitorId=${salvo.leitorId}`}>Consultar reservas do leitor</Link></div>}
  </Pagina>;
}

export default { id: "uc17", titulo: "Reservar exemplar", caminho: "/reservas/criar", Componente: ReservarExemplar };
