import { afterEach, beforeEach, expect, test } from "bun:test";
import { captureLogs } from "../src/infrastructure/log";
import { traceIdOf } from "../src/infrastructure/trace";
import { createApp } from "../src/server";

const FORMAT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
const RECEIVED = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

const app = createApp([
  (api) => api.get("/teste/:id", (c) => c.json({ id: c.req.param("id") })),
  (api) => api.get("/teste-erro", () => { throw new Error("explodiu"); }),
]);

let capture: ReturnType<typeof captureLogs>;
beforeEach(() => {
  capture = captureLogs();
});
afterEach(() => capture.restore());

test("toda resposta da API traz um traceparent válido", async () => {
  const response = await app.request("/api/teste/42");
  expect(response.status).toBe(200);
  expect(response.headers.get("traceparent")).toMatch(FORMAT);
});

test("o traceparent recebido continua: mesmo trace-id, span novo", async () => {
  const response = await app.request("/api/teste/42", { headers: { traceparent: RECEIVED } });
  const sent = response.headers.get("traceparent");
  expect(traceIdOf(sent)).toBe(traceIdOf(RECEIVED)!);
  expect(sent).not.toBe(RECEIVED);
});

test("traceparent malformado não derruba a requisição: começa outro trace", async () => {
  const response = await app.request("/api/teste/42", { headers: { traceparent: "lixo" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("traceparent")).toMatch(FORMAT);
});

test("o log de acesso tem método, padrão da rota, status, duração e trace_id", async () => {
  const response = await app.request("/api/teste/42");
  const access = capture.lines.find((line) => line.msg === "requisição");
  expect(access).toMatchObject({ method: "GET", route: "/api/teste/:id", status: 200, trace_id: traceIdOf(response.headers.get("traceparent"))! });
  expect(typeof access!.duration_ms).toBe("number");
});

test("o erro 500 sai no log com o mesmo trace_id da resposta", async () => {
  const response = await app.request("/api/teste-erro");
  expect(response.status).toBe(500);
  const error = capture.lines.find((line) => line.level === "error");
  expect(error).toMatchObject({ msg: "erro interno", error: "explodiu", trace_id: traceIdOf(response.headers.get("traceparent"))! });
});
