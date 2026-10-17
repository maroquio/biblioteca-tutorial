/* oxlint-disable react/only-export-components -- O registro de cada UC exporta metadados e componente para o carregamento automático. */
import { type Exemplar } from "../api.ts";
import { ExclusaoRegistro, Pagina } from "../components/biblioteca.tsx";

function ExcluirExemplar() {
  return <Pagina titulo="Excluir exemplar" descricao="Remova uma cópia física que ainda não tenha histórico de circulação.">
    <ExclusaoRegistro<Exemplar> endpoint="/api/exemplares" rotulo={(exemplar) => `${exemplar.numeroRegistro} · ${exemplar.titulo}`} retorno="/exemplares" aviso="A exclusão é definitiva. Exemplares com qualquer reserva ou empréstimo, mesmo encerrados, não podem ser excluídos." />
  </Pagina>;
}

export default { id: "uc16", titulo: "Excluir exemplar", caminho: "/exemplares/excluir", Componente: ExcluirExemplar };
