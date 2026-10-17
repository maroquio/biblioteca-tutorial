import { emTransacao } from "../../infrastructure/transaction";
import { diaDoCatalogo } from "./domain/dadosDoLivro";
import { dadosFisicos } from "./domain/dadosDoExemplar";
import type { IntegracaoDoCatalogo } from "./catalogo";
import { exemplarDoCatalogo, type ExemplarDoCatalogo } from "./exemplares";

export async function atualizarExemplar(id: number, body: unknown, integracao: IntegracaoDoCatalogo, agora = new Date()): Promise<ExemplarDoCatalogo> {
  const dados = dadosFisicos(body);
  const hoje = diaDoCatalogo(agora);
  return emTransacao(async (tx) => {
    await exemplarDoCatalogo(tx, id, integracao, hoje);
    await tx`UPDATE exemplares SET localizacao = ${dados.localizacao}, estado_conservacao = ${dados.estadoConservacao} WHERE id = ${id}`;
    return exemplarDoCatalogo(tx, id, integracao, hoje);
  });
}
