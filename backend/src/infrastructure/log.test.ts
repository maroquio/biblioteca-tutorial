import { afterEach, beforeEach, expect, test } from "bun:test";
import { captureLogs, log } from "./log";
import { traceIdOf, withTrace } from "./trace";

let capture: ReturnType<typeof captureLogs>;
beforeEach(() => {
  capture = captureLogs();
});
afterEach(() => capture.restore());

test("cada linha é um JSON com time, level, service, msg e os campos do caso", () => {
  log.info("livro indexado", { book_id: 3 });
  const [line] = capture.lines;
  expect(line).toMatchObject({ level: "info", service: process.env.SERVICE_NAME ?? "app", msg: "livro indexado", book_id: 3 });
  expect(new Date(String(line!.time)).toISOString()).toBe(String(line!.time));
});

test("warn e error saem com o próprio nível", () => {
  log.warn("fila indisponível");
  log.error("erro interno");
  expect(capture.lines.map((line) => line.level)).toEqual(["warn", "error"]);
});

test("dentro de withTrace a linha leva o trace_id; fora, não", async () => {
  const traceparent = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
  await withTrace(traceparent, async () => {
    await Bun.sleep(1);
    log.info("dentro");
  });
  log.info("fora");
  const [inside, outside] = capture.lines;
  expect(inside!.trace_id).toBe(traceIdOf(traceparent)!);
  expect(outside).not.toHaveProperty("trace_id");
});

test("um Error vira a mensagem, numa linha só, mesmo com aspas e quebra de linha", () => {
  log.error("falhou", { error: new Error('aspas "duplas"\nsegunda linha') });
  expect(capture.raw).toHaveLength(1);
  expect(capture.raw[0]).not.toContain("\n");
  expect(capture.lines[0]!.error).toBe('aspas "duplas"\nsegunda linha');
});
