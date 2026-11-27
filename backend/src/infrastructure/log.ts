import { currentTraceparent, traceIdOf } from "./trace";

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

/** "app" ou "worker": o compose define SERVICE_NAME em cada serviço. */
const SERVICE = process.env.SERVICE_NAME ?? "app";

// Na suíte (o bun test define NODE_ENV=test), o log fica mudo para não misturar
// centenas de linhas com o resultado dos testes; captureLogs() lê o que sairia.
let write: (line: string) => void = process.env.NODE_ENV === "test" ? () => {} : (line) => console.log(line);

/**
 * Uma linha JSON por evento: time, level, service, msg, o trace_id da
 * requisição ou da tarefa em andamento e os campos do caso.
 *
 * Nunca registre dado pessoal (nome, CPF, e-mail) nem segredo: registre o id.
 */
function emit(level: Level, msg: string, fields: Fields = {}): void {
  const extra = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, value instanceof Error ? value.message : value]),
  );
  const trace_id = traceIdOf(currentTraceparent()) ?? undefined;
  write(JSON.stringify({ time: new Date().toISOString(), level, service: SERVICE, msg, trace_id, ...extra }));
}

export const log = {
  info: (msg: string, fields?: Fields) => emit("info", msg, fields),
  warn: (msg: string, fields?: Fields) => emit("warn", msg, fields),
  error: (msg: string, fields?: Fields) => emit("error", msg, fields),
};

/** Para os testes: guarda as linhas em vez de escrever no terminal. */
export function captureLogs() {
  const raw: string[] = [];
  const previous = write;
  write = (line) => {
    raw.push(line);
  };
  return {
    raw,
    get lines(): Fields[] {
      return raw.map((line) => JSON.parse(line) as Fields);
    },
    restore() {
      write = previous;
    },
  };
}
