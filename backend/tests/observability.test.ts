import { afterEach, beforeEach, expect, test } from "bun:test";
import { captureLogs } from "../src/infrastructure/log";
import { renderHttpMetrics, resetMetrics } from "../src/infrastructure/metrics";
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
  resetMetrics();
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

test("a métrica usa o padrão da rota, nunca a URL com o id", async () => {
  await app.request("/api/teste/42");
  await app.request("/api/teste/43");
  const text = renderHttpMetrics();
  expect(text).toContain('route="/api/teste/:id",status="200",le="+Inf"} 2');
  expect(text).not.toContain("/api/teste/42");
});

test("uma rota que não existe não vira rótulo com a URL", async () => {
  const response = await app.request("/api/nao-existe/123");
  expect(response.status).toBe(404);
  const text = renderHttpMetrics();
  expect(text).toContain('status="404"');
  expect(text).not.toContain("nao-existe");
});

test("o erro 500 sai no log com o mesmo trace_id da resposta", async () => {
  const response = await app.request("/api/teste-erro");
  expect(response.status).toBe(500);
  const error = capture.lines.find((line) => line.level === "error");
  expect(error).toMatchObject({ msg: "erro interno", error: "explodiu", trace_id: traceIdOf(response.headers.get("traceparent"))! });
});

test("/metrics responde no formato do Prometheus e não entra no log de acesso", async () => {
  await app.request("/api/teste/42");
  const response = await app.request("/metrics");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toStartWith("text/plain; version=0.0.4");
  expect(await response.text()).toContain('route="/api/teste/:id"');
  expect(capture.lines.filter((line) => line.msg === "requisição")).toHaveLength(1);
});
