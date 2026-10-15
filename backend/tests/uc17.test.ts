import { ReservarExemplar } from "../src/modules/circulacao/domain/ReservarExemplar";
import { expect, test } from "bun:test";
import { cenario } from "./circulacaoDouble";
import { hoje } from "../src/modules/circulacao/domain/modelo";
import { somarDias } from "../src/modules/circulacao/domain/modelo";
import { api, exemplarDeTeste } from "./suporte-api";
import { leitorDeTeste } from "./leitoresApiFixture";

test("UC17 reserva imediatamente com sete dias corridos de exclusividade", async () => {
  const { criar } = cenario();
  const reservar = criar(ReservarExemplar);
  const reserva = await reservar.executar(1, 1);
  expect(reserva).toMatchObject({ dataReserva: "2026-10-15", dataLimiteRetirada: "2026-10-21", dataExpiracao: "2026-10-22", situacao: "ativa", leitorNome: "Leitor 1" });
  await expect(reservar.executar(2, 1)).rejects.toThrow("indisponível");
});

test("UC17 API: reserva tem janela inclusiva7 dias e recusa terceiro pedido", async () => {
  const leitor = await leitorDeTeste();
  const exemplares = await Promise.all([exemplarDeTeste(), exemplarDeTeste(), exemplarDeTeste()]);
  const reservar = (exemplarId: number, extra = {}) => api("POST", "/reservas", { leitorId: leitor.id, exemplarId, ...extra });
  const primeira = await reservar(exemplares[0]!.id);
  expect(primeira.status).toBe(201);
  expect(await primeira.json()).toMatchObject({ leitorId: leitor.id, exemplarId: exemplares[0]!.id, dataReserva: hoje(), dataLimiteRetirada: somarDias(hoje(), 6), dataExpiracao: somarDias(hoje(), 7), situacao: "ativa" });
  expect((await reservar(exemplares[1]!.id)).status).toBe(201);
  expect((await reservar(exemplares[2]!.id)).status).toBe(409);
  expect((await reservar(exemplares[2]!.id, { dataReserva: somarDias(hoje(), 1) })).status).toBe(400);
  expect((await api("POST", "/reservas", { leitorId: 2147483647, exemplarId: exemplares[2]!.id })).status).toBe(404);
});

test("UC17 API: concorrência não ultrapassa duas reservas nem duplica reserva da cópia", async () => {
  const leitor = await leitorDeTeste();
  const exemplares = await Promise.all([exemplarDeTeste(), exemplarDeTeste(), exemplarDeTeste()]);
  const resultados = await Promise.all(exemplares.map(e => api("POST", "/reservas", { leitorId: leitor.id, exemplarId: e.id })));
  expect(resultados.filter(r => r.status === 201)).toHaveLength(2);
  expect(resultados.filter(r => r.status === 409)).toHaveLength(1);
  const livre = await exemplarDeTeste(); const a = await leitorDeTeste(); const b = await leitorDeTeste();
  const disputa = await Promise.all([a, b].map(l => api("POST", "/reservas", { leitorId: l.id, exemplarId: livre.id })));
  expect(disputa.filter(r => r.status === 201)).toHaveLength(1);
  expect(disputa.filter(r => r.status === 409)).toHaveLength(1);
});

test("UC17 recusa a terceira reserva do leitor sem alterar o exemplar", async () => {
  const { criar, memoria } = cenario();
  const reservar = criar(ReservarExemplar);
  await reservar.executar(1, 1); await reservar.executar(1, 2);
  await expect(reservar.executar(1, 3)).rejects.toThrow("duas reservas");
  expect(memoria.reservasSalvas).toHaveLength(2);
  expect((await reservar.executar(2, 3)).situacao).toBe("ativa");
});

test("UC17 reserva expira no início do oitavo dia e libera o limite e a cópia", async () => {
  const { criar, tempo } = cenario();
  const reservar = criar(ReservarExemplar);
  await reservar.executar(1, 1); await reservar.executar(1, 2);
  tempo.agora = "2026-10-21T23:59:59-03:00";
  await expect(reservar.executar(2, 1)).rejects.toThrow("indisponível");
  tempo.agora = "2026-10-22T00:00:00-03:00";
  expect((await reservar.executar(2, 1)).situacao).toBe("ativa");
  expect((await reservar.executar(1, 3)).situacao).toBe("ativa");
});

test("UC17 exige vínculos existentes e usa data civil brasileira", async () => {
  const { criar } = cenario();
  const reservar = criar(ReservarExemplar);
  await expect(reservar.executar(99, 1)).rejects.toThrow("Leitor não encontrado");
  await expect(reservar.executar(1, 99)).rejects.toThrow("Exemplar não encontrado");
  expect(hoje(() => new Date("2026-10-16T01:00:00Z"))).toBe("2026-10-15");
});

test("UC17 API: IDs não aceitam booleanos, arrays, nulos ou notação exponencial", async () => {
  const leitor = await leitorDeTeste(); const exemplar = await exemplarDeTeste();
  for (const invalido of [true, [leitor.id], null, {}, "1e0", 0]) {
    expect((await api("POST", "/reservas", { leitorId: invalido, exemplarId: exemplar.id })).status).toBe(400);
    expect((await api("POST", "/reservas", { leitorId: leitor.id, exemplarId: invalido })).status).toBe(400);
  }
});
