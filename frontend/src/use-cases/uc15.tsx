/* oxlint-disable react/only-export-components -- O registro de cada UC exporta metadados e componente para o carregamento automático. */
import { type Exemplar } from "../api.ts";
import { FormularioRegistro, Pagina } from "../components/biblioteca.tsx";
import { CamposExemplar } from "./uc13.tsx";

function AtualizarExemplar() {
  return <Pagina titulo="Atualizar exemplar" descricao="Corrija a localização ou o estado de conservação da cópia física.">
    <FormularioRegistro<Exemplar> endpoint="/api/exemplares" editar rotulo={(exemplar) => `${exemplar.numeroRegistro} · ${exemplar.titulo}`} campos={(exemplar) => <CamposExemplar exemplar={exemplar} />} montar={(dados) => ({ localizacao: String(dados.get("localizacao")), estadoConservacao: String(dados.get("estadoConservacao")) })} sucesso={(exemplar) => `Exemplar ${exemplar.numeroRegistro} atualizado.`} retorno="/exemplares" acao="Salvar alterações" />
  </Pagina>;
}

export default { id: "uc15", titulo: "Atualizar exemplar", caminho: "/exemplares/editar", Componente: AtualizarExemplar };
