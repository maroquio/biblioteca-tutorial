import { emTransacao } from "../../infrastructure/transaction";
import { RuleConflict } from "../../shared/errors";
import { diaDoCatalogo } from "./domain/dadosDoLivro";
import type { IntegracaoDoCatalogo } from "./catalogo";
import { exemplarDoCatalogo } from "./exemplares";

export async function excluirExemplar(id: number, integracao: IntegracaoDoCatalogo): Promise<void> {
  await emTransacao(async (tx) => {
    await exemplarDoCatalogo(tx, id, integracao, diaDoCatalogo(new Date()));
    if (await integracao.exemplarTemHistorico(tx, id)) throw new RuleConflict("Exemplar possui histórico de reservas ou empréstimos e não pode ser excluído");
    await tx`DELETE FROM exemplares WHERE id = ${id}`;
  });
}
