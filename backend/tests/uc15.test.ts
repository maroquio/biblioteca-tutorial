import { expect, test } from "bun:test";
import { api, exemplarDeTeste } from "./suporte-api";

test("UC15: altera dados físicos preservando livro e número de registro", async () => {
  const exemplar = await exemplarDeTeste();
  const dados = { localizacao: "Sala 3 / Estante B", estadoConservacao: "desgastado" };
  const response = await api("PUT", `/exemplares/${exemplar.id}`, { ...dados, livroId: 2147483647, numeroRegistro: "1999-000001" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ...dados, livroId: exemplar.livroId, numeroRegistro: exemplar.numeroRegistro });
  expect((await api("PUT", `/exemplares/${exemplar.id}`, { ...dados, localizacao: " " })).status).toBe(400);
  expect((await api("PUT", "/exemplares/2147483647", dados)).status).toBe(404);
});
