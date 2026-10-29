import { expect, test } from "bun:test";
import { createRedis, ready, redis, redisKey } from "./redis";

test("redisKey prefixa o namespace do ambiente", () => {
  expect(redisKey("autoria", "x")).toBe(`${process.env.REDIS_PREFIX ?? "biblioteca"}:autoria:x`);
});

test("o Redis 8 do compose responde", async () => {
  expect(await (await ready(redis!)).send("PING", [])).toBe("PONG");
  expect(String(await redis!.send("INFO", ["server"]))).toContain("redis_version:8");
});

test("cliente sem servidor falha rápido", async () => {
  const dead = createRedis("redis://127.0.0.1:1", { autoReconnect: false });
  const started = performance.now();
  await expect(ready(dead)).rejects.toThrow();
  expect(performance.now() - started).toBeLessThan(3000);
});
