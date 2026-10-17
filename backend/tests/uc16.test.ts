import { expect, test } from "bun:test";
import { RuleConflict } from "../src/shared/errors";
import { integracaoDoCatalogo } from "../src/adapters/acervoIntegracao";
import { excluirExemplar } from "../src/modules/acervo/excluirExemplar";
import { api, exemplarDeTeste } from "./suporte-api";

test("UC16: exclui exemplar sem histórico e informa ausência na repetição", async () => {
  const exemplar = await exemplarDeTeste();
  expect((await api("DELETE", `/exemplares/${exemplar.id}`)).status).toBe(204);
  expect((await api("DELETE", `/exemplares/${exemplar.id}`)).status).toBe(404);
});

test("UC16: histórico informado pela integração impede exclusão física", async () => {
  const exemplar = await exemplarDeTeste();
  // A porta permite provar a regra antes de os UCs de circulação estarem integrados.
  await expect(excluirExemplar(exemplar.id, { ...integracaoDoCatalogo, exemplarTemHistorico: async () => true })).rejects.toBeInstanceOf(RuleConflict);
});
