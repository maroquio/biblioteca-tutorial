import { expect, test } from "bun:test";
import { createApp } from "../src/server";
import { ServiceUnavailable } from "../src/shared/errors";

test("serviço externo indisponível responde 503 com a mensagem", async () => {
  const app = createApp([(api) => api.get("/indisponivel", () => { throw new ServiceUnavailable("Fora do ar"); })]);
  const response = await app.request("/api/indisponivel");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Fora do ar" });
});
