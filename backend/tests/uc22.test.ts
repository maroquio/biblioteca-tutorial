import { ReservarExemplar } from "../src/modules/circulacao/domain/ReservarExemplar";
import { ConsultarReservas } from "../src/modules/circulacao/domain/ConsultarReservas";
import { expect, test } from "bun:test";
import { cenario } from "./circulacaoDouble";
import { api, exemplarDeTeste } from "./suporte-api";
import { leitorDeTeste } from "./leitoresApiFixture";
import { hoje } from "../src/modules/circulacao/domain/modelo";
import { emTransacao } from "../src/infrastructure/transaction";

test("UC22 filtra reservas por leitor, exemplar e situação derivada sem apagar histórico", async () => {
  const { criar, tempo, memoria } = cenario();
  const reservar = criar(ReservarExemplar);
  const reservas = criar(ConsultarReservas);
  const primeira = await reservar.executar(1, 1);
  const segunda = await reservar.executar(2, 2);
  memoria.reservasSalvas.find(r => r.id === segunda.id)!.situacao = "cancelada";
  tempo.agora = "2026-10-22T12:00:00Z";
  expect((await reservas.obter(primeira.id)).situacao).toBe("expirada");
  expect(await reservas.executar({ leitorId: 1, exemplarId: 1, situacao: "expirada" })).toHaveLength(1);
  expect(await reservas.executar({ situacao: "cancelada" })).toHaveLength(1);
  expect(await reservas.executar()).toHaveLength(2);
  await expect(reservas.executar({ situacao: "erro" })).rejects.toThrow("inválida");
});

test("UC22 API: lista com nomes e filtros e deriva expiração na data corrente", async () => {
  const leitor = await leitorDeTeste(); const exemplar = await exemplarDeTeste();
  const reserva = await (await api("POST", "/reservas", { leitorId: leitor.id, exemplarId: exemplar.id })).json();
  const individual = await api("GET", `/reservas/${reserva.id}`);
  expect(individual.status).toBe(200);
  expect(await individual.json()).toMatchObject({ id: reserva.id, leitorNome: leitor.nome, leitorCpf: leitor.cpf, numeroRegistro: exemplar.numeroRegistro, situacao: "ativa" });
  const lista = await api("GET", `/reservas?leitorId=${leitor.id}&exemplarId=${exemplar.id}&situacao=ativa`);
  expect(await lista.json<unknown[]>()).toEqual([expect.objectContaining({ id: reserva.id })]);
  await emTransacao(async tx => { await tx`UPDATE reservas SET data_expiracao = ${hoje()} WHERE id = ${reserva.id}`; });
  expect(await (await api("GET", `/reservas?leitorId=${leitor.id}&situacao=expirada`)).json<unknown[]>()).toEqual([expect.objectContaining({ id: reserva.id, situacao: "expirada" })]);
  expect((await api("GET", "/reservas?situacao=invalida")).status).toBe(400);
  expect((await api("GET", "/reservas/2147483647")).status).toBe(404);
});
