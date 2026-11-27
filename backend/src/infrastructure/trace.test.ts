import { expect, test } from "bun:test";
import { continueTrace, currentTraceparent, newTraceparent, traceIdOf, withTrace } from "./trace";

const FORMAT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
const RECEIVED = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const RECEIVED_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

test("um traceparent novo segue o formato da W3C e não se repete", () => {
  expect(newTraceparent()).toMatch(FORMAT);
  expect(newTraceparent()).not.toBe(newTraceparent());
});

test("continuar um trace recebido mantém o trace-id e troca o span-id", () => {
  const next = continueTrace(RECEIVED);
  expect(next).toMatch(FORMAT);
  expect(traceIdOf(next)).toBe(RECEIVED_TRACE_ID);
  expect(next).not.toBe(RECEIVED);
});

test("cabeçalho ausente, malformado, zerado ou em maiúsculas começa um trace novo", () => {
  const invalid = [
    undefined,
    null,
    "",
    "lixo",
    "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
    RECEIVED.toUpperCase(),
    RECEIVED.replace(/^00/, "ff"),
  ];
  for (const header of invalid) {
    const next = continueTrace(header);
    expect(next).toMatch(FORMAT);
    expect(traceIdOf(next)).not.toBe(RECEIVED_TRACE_ID);
  }
  expect(traceIdOf("lixo")).toBeNull();
});

test("dentro de withTrace, todo await enxerga o mesmo traceparent; fora, null", async () => {
  expect(currentTraceparent()).toBeNull();
  const seen = await withTrace(RECEIVED, async () => {
    await Bun.sleep(1);
    await Promise.resolve();
    return currentTraceparent();
  });
  expect(seen).toBe(RECEIVED);
  expect(currentTraceparent()).toBeNull();
});

test("duas requisições ao mesmo tempo não misturam os traces", async () => {
  const other = newTraceparent();
  const [a, b] = await Promise.all([
    withTrace(RECEIVED, async () => {
      await Bun.sleep(5);
      return currentTraceparent();
    }),
    withTrace(other, async () => {
      await Bun.sleep(1);
      return currentTraceparent();
    }),
  ]);
  expect(a).toBe(RECEIVED);
  expect(b).toBe(other);
});
