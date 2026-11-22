import { expect, test } from "bun:test";
import { createApp } from "../src/server";
import { NotImplemented, PayloadTooLarge, ServiceUnavailable } from "../src/shared/errors";

test("serviço externo indisponível responde 503 com a mensagem", async () => {
  const app = createApp([(api) => api.get("/indisponivel", () => { throw new ServiceUnavailable("Fora do ar"); })]);
  const response = await app.request("/api/indisponivel");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Fora do ar" });
});

test("corpo grande demais responde 413 com a mensagem", async () => {
  const app = createApp([(api) => api.put("/grande", () => { throw new PayloadTooLarge("Grande demais"); })]);
  const response = await app.request("/api/grande", { method: "PUT" });
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "Grande demais" });
});

test("parte do contrato ainda não implementada responde 501 com a mensagem", async () => {
  const app = createApp([(api) => api.get("/pendente", () => { throw new NotImplemented("Falta fazer"); })]);
  const response = await app.request("/api/pendente");
  expect(response.status).toBe(501);
  expect(await response.json()).toEqual({ error: "Falta fazer" });
});
