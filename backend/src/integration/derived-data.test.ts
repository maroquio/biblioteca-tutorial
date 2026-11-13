import { expect, test } from "bun:test";
import { testAuthor, testIsbn } from "#tests/api";
import { sql } from "../infrastructure/postgres";
import { createRedis, ready } from "../infrastructure/redis";
import { reconcileBookVectors, refreshDerivedDataOnConnect } from "./derivedData";

test("cada conexão ao Redis invalida o cache de autores", async () => {
  const client = createRedis(process.env.REDIS_URL!);
  let refreshes = 0;
  refreshDerivedDataOnConnect(client, async () => { refreshes++; });
  await ready(client);
  for (let i = 0; i < 50 && refreshes === 0; i++) await Bun.sleep(10);
  expect(refreshes).toBe(1);
  client.close();
});

test("a subida reconcilia os vetores dos livros sem passar pelo Redis", async () => {
  const author = await testAuthor();
  const [book] = await sql`INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao) VALUES (${testIsbn()}, ${`Livro ${crypto.randomUUID().slice(0, 8)}`}, ${author.id}, '2026-01-01') RETURNING id` as { id: number }[];
  await reconcileBookVectors();
  const [vector] = await sql`SELECT livro_id FROM livros_vetores WHERE livro_id = ${book!.id}`;
  expect(vector).toBeDefined();
});
