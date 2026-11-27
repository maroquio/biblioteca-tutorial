import { beforeEach, expect, test } from "bun:test";
import { observeRequest, renderHttpMetrics, renderQueueMetrics, resetMetrics } from "./metrics";
import { createRedis, redisKey } from "./redis";

const NAME = "http_server_request_duration_seconds";
const LABELS = 'method="GET",route="/api/livros/:id",status="200"';

beforeEach(() => resetMetrics());

test("o histograma sai no formato de texto do Prometheus", () => {
  observeRequest("GET", "/api/livros/:id", 200, 0.03);
  const text = renderHttpMetrics();
  expect(text).toContain(`# TYPE ${NAME} histogram`);
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="0.025"} 0`);
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="0.05"} 1`);
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="+Inf"} 1`);
  expect(text).toContain(`${NAME}_sum{${LABELS}} 0.03`);
  expect(text).toContain(`${NAME}_count{${LABELS}} 1`);
});

test("os baldes são cumulativos e o +Inf é igual ao _count", () => {
  for (const seconds of [0.004, 0.2, 7]) observeRequest("GET", "/api/livros/:id", 200, seconds);
  const text = renderHttpMetrics();
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="0.005"} 1`);
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="0.25"} 2`);
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="5"} 2`);
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="10"} 3`);
  expect(text).toContain(`${NAME}_bucket{${LABELS},le="+Inf"} 3`);
  expect(text).toContain(`${NAME}_count{${LABELS}} 3`);
});

test("cada combinação de método, rota e status é uma série", () => {
  observeRequest("GET", "/api/livros/:id", 200, 0.01);
  observeRequest("GET", "/api/livros/:id", 404, 0.01);
  observeRequest("POST", "/api/livros", 201, 0.01);
  const counts = renderHttpMetrics().split("\n").filter((line) => line.startsWith(`${NAME}_count`));
  expect(counts).toHaveLength(3);
});

test("aspas, barra invertida e quebra de linha no rótulo são escapadas", () => {
  observeRequest("GET", 'a"b\\c\nd', 200, 0.01);
  expect(renderHttpMetrics()).toContain('route="a\\"b\\\\c\\nd"');
});

test("as métricas da fila saem por stream: aguardando, pendentes e mortas", async () => {
  const client = createRedis(process.env.TEST_QUEUE_URL ?? "redis://fila:6379");
  try {
    const key = redisKey("testes-das-metricas", crypto.randomUUID());
    await client.connect();
    await client.send("XGROUP", ["CREATE", key, "workers", "0", "MKSTREAM"]);
    await client.send("XADD", [key, "*", "dados", "{}"]);
    await client.send("XADD", [key, "*", "dados", "{}"]);
    // uma entregue e não confirmada (pendente), outra ainda não entregue (aguardando)
    await client.send("XREADGROUP", ["GROUP", "workers", "teste", "COUNT", "1", "STREAMS", key, ">"]);
    await client.send("XADD", [`${key}:mortas`, "*", "dados", "{}"]);
    const text = await renderQueueMetrics(client);
    expect(text).toContain("# TYPE queue_dead_letters gauge");
    expect(text).toContain(`queue_messages_waiting{stream="${key}"} 1`);
    expect(text).toContain(`queue_messages_pending{stream="${key}"} 1`);
    expect(text).toContain(`queue_dead_letters{stream="${key}"} 1`);
    expect(text).not.toContain(`stream="${key}:mortas"`);
  } finally {
    client.close();
  }
});

test("só entram os streams do prefixo deste ambiente", async () => {
  const client = createRedis(process.env.TEST_QUEUE_URL ?? "redis://fila:6379");
  try {
    const other = `outro-ambiente:${crypto.randomUUID()}`;
    await client.connect();
    await client.send("XADD", [other, "*", "dados", "{}"]);
    expect(await renderQueueMetrics(client)).not.toContain(other);
    await client.send("DEL", [other]);
  } finally {
    client.close();
  }
});

test("sem fila, ou com ela fora do ar, as métricas da fila ficam vazias", async () => {
  expect(await renderQueueMetrics(null)).toBe("");
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  expect(await renderQueueMetrics(dead)).toBe("");
});

test("com a fila travada, as métricas da fila desistem antes do timeout do scrape", async () => {
  // um "Redis" que aceita a conexão, responde ao HELLO e depois fica mudo: é o
  // que o app vê com a fila travada ou caindo enquanto o cliente reconecta
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        if (/HELLO/i.test(new TextDecoder().decode(data))) socket.write("%1\r\n+server\r\n+redis\r\n");
      },
    },
  });
  const client = createRedis(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
  try {
    const start = performance.now();
    // o Prometheus desiste da coleta em 5 s, e aí perde também o histograma
    const text = await Promise.race([renderQueueMetrics(client), Bun.sleep(4000).then(() => "travou")]);
    expect(text).toBe("");
    expect(performance.now() - start).toBeLessThan(2500);
  } finally {
    client.close();
    server.stop(true);
  }
});
