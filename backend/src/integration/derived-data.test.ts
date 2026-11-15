
import { expect, test } from "bun:test";
import { createRedis, ready } from "../infrastructure/redis";
import { refreshAuthorSearchOnConnect } from "./derivedData";

test("cada conexão ao Redis invalida o cache de autores", async () => {
  const client = createRedis(process.env.REDIS_URL!);
  let refreshes = 0;

  refreshAuthorSearchOnConnect(client, async () => {
    refreshes++;
  });

  await ready(client);

  for (let i = 0; i < 50 && refreshes === 0; i++) {
    await Bun.sleep(10);
  }

  expect(refreshes).toBe(1);

  client.close();
});
