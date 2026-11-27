import { AsyncLocalStorage } from "node:async_hooks";

/**
 * O id de correlação, no formato traceparent da W3C (o cabeçalho que o
 * OpenTelemetry usa; quando o tracing chegar, ele continua o mesmo trace):
 *
 *   00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
 *      trace-id: a requisição inteira,   span-id: este trecho
 *      do navegador ao worker
 */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

function randomHex(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("hex");
}

/** Um trecho novo do trace; sem trace-id, começa um trace novo. */
export function newTraceparent(traceId: string = randomHex(16)): string {
  return `00-${traceId}-${randomHex(8)}-01`;
}

/** O trace-id de um traceparent válido; null se vier malformado ou zerado. */
export function traceIdOf(traceparent: string | null | undefined): string | null {
  const traceId = traceparent?.match(TRACEPARENT)?.[1];
  return traceId && !/^0+$/.test(traceId) ? traceId : null;
}

/**
 * Continua o trace que chegou (no cabeçalho HTTP ou no campo da mensagem da
 * fila) com um span novo, ou começa outro quando não veio nada aproveitável.
 * Nunca lança: um cabeçalho ruim não pode derrubar a requisição.
 */
export function continueTrace(traceparent: string | null | undefined): string {
  return newTraceparent(traceIdOf(traceparent) ?? undefined);
}

// Acompanha a requisição (ou a tarefa da fila) por todos os await, sem passar o
// traceparent de função em função.
const current = new AsyncLocalStorage<string>();

/** Roda fn, e tudo o que ela chamar, dentro deste traceparent. */
export function withTrace<T>(traceparent: string, fn: () => T): T {
  return current.run(traceparent, fn);
}

/** O traceparent de quem está rodando agora; null fora de withTrace. */
export function currentTraceparent(): string | null {
  return current.getStore() ?? null;
}
