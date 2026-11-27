import type { RedisClient } from "bun";
import { log } from "./log";
import { ready, redisKey } from "./redis";

/**
 * As métricas da aplicação, no formato de texto que o Prometheus lê em /metrics.
 *
 * Um histograma só responde às três perguntas do método RED:
 *   Rate     quantas requisições por segundo?   → _count
 *   Errors   quantas deram erro?                → _count com status="5.."
 *   Duration quanto tempo levam?                → _bucket (p50, p95, p99)
 * O nome é o mesmo que o OpenTelemetry usa para a duração das requisições HTTP.
 */
const NAME = "http_server_request_duration_seconds";

/** Limites dos baldes, em segundos. */
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

type Series = { labels: string; buckets: number[]; sum: number; count: number };

/**
 * Uma série por combinação de rótulos. A rota é o padrão casado pelo Hono
 * ("/api/livros/:id"), nunca a URL: cada valor novo de rótulo é mais uma série
 * guardada para sempre (é a "cardinalidade"). Nada pessoal em rótulo.
 */
const series = new Map<string, Series>();

/** O valor de um rótulo no formato do Prometheus: \, " e quebra de linha escapados. */
function labelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

export function observeRequest(method: string, route: string, status: number, seconds: number): void {
  const labels = `method="${labelValue(method)}",route="${labelValue(route)}",status="${status}"`;
  let current = series.get(labels);
  if (!current) series.set(labels, (current = { labels, buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }));
  // cumulativo: uma requisição de 30 ms conta em "até 50 ms" e em todos os maiores
  BUCKETS.forEach((limit, i) => {
    if (seconds <= limit) current.buckets[i]!++;
  });
  current.sum += seconds;
  current.count++;
}

export function renderHttpMetrics(): string {
  const lines = [`# HELP ${NAME} Duração das requisições HTTP da API, em segundos.`, `# TYPE ${NAME} histogram`];
  for (const { labels, buckets, sum, count } of series.values()) {
    BUCKETS.forEach((limit, i) => lines.push(`${NAME}_bucket{${labels},le="${limit}"} ${buckets[i]}`));
    lines.push(`${NAME}_bucket{${labels},le="+Inf"} ${count}`, `${NAME}_sum{${labels}} ${sum}`, `${NAME}_count{${labels}} ${count}`);
  }
  return lines.join("\n") + "\n";
}

const DEAD_SUFFIX = ":mortas";

/** Todos os streams deste ambiente (prefixo do REDIS_PREFIX) no Redis da fila. */
async function streamsOf(client: RedisClient): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";
  do {
    const [next, batch] = await client.send("SCAN", [cursor, "MATCH", redisKey("*"), "TYPE", "stream", "COUNT", "500"]) as [string, string[]];
    keys.push(...batch);
    cursor = next;
  } while (cursor !== "0");
  return keys.sort();
}

/**
 * Gauges da fila, lidos do Redis na hora da coleta (o worker não precisa abrir
 * porta): por stream, quantas mensagens aguardam um worker, quantas foram
 * entregues e não confirmadas, e quantas estão na fila de mortas. Sem fila, ou
 * com ela fora do ar, devolve "" e as métricas HTTP saem assim mesmo.
 *
 * Com a fila caindo, o cliente fica tentando reconectar e o comando não volta:
 * por isso o limite de tempo, bem abaixo dos 5 s que o Prometheus espera pela
 * coleta inteira. Sem ele, a coleta estoura e o histograma some junto.
 */
export async function renderQueueMetrics(client: RedisClient | null, timeoutMs = 1500): Promise<string> {
  if (!client) return "";
  let timer: Timer | undefined;
  const giveUp = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`a fila não respondeu em ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    return await Promise.race([queueGauges(client), giveUp]);
  } catch (error) {
    log.warn("métricas da fila indisponíveis", { error: error as Error });
    return "";
  } finally {
    clearTimeout(timer);
  }
}

async function queueGauges(client: RedisClient): Promise<string> {
  await ready(client);
  const waiting: string[] = [];
  const pending: string[] = [];
  const dead: string[] = [];
  for (const key of await streamsOf(client)) {
    if (key.endsWith(DEAD_SUFFIX)) continue;
    const label = `{stream="${labelValue(key)}"}`;
    const groups = await client.send("XINFO", ["GROUPS", key]) as { name: string; lag: number | null; pending: number }[];
    const group = groups.find((g) => g.name === "workers");
    waiting.push(`queue_messages_waiting${label} ${group ? (group.lag ?? 0) : await client.send("XLEN", [key])}`);
    pending.push(`queue_messages_pending${label} ${group?.pending ?? 0}`);
    dead.push(`queue_dead_letters${label} ${await client.send("XLEN", [key + DEAD_SUFFIX])}`);
  }
  const gauge = (name: string, help: string, values: string[]) => [`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, ...values];
  return [
    ...gauge("queue_messages_waiting", "Mensagens publicadas e ainda não entregues a um worker.", waiting),
    ...gauge("queue_messages_pending", "Mensagens entregues a um worker e ainda não confirmadas.", pending),
    ...gauge("queue_dead_letters", "Mensagens na fila de mortas: alguém precisa olhar.", dead),
  ].join("\n") + "\n";
}

/** Para os testes: começa do zero. */
export function resetMetrics(): void {
  series.clear();
}
