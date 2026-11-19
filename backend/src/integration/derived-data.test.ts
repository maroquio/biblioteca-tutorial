import { expect, test } from "bun:test";
import { createRedis, ready } from "../infrastructure/redis";
import { refreshDerivedDataOnConnect } from "./derivedData";
import { testAuthor, testIsbn } from "#tests/api";
import { sql } from "../infrastructure/postgres";
import { refreshBookVectors } from "./derivedData";

test("cada conexão ao Redis recalcula os dados derivados", async () => {
  const client = createRedis(process.env.REDIS_URL!);
  let refreshes = 0;
  refreshDerivedDataOnConnect(client, async () => { refreshes++; });
  await ready(client);
  for (let i = 0; i < 50 && refreshes === 0; i++) await Bun.sleep(10);
  expect(refreshes).toBe(1);
  client.close();
});

test("a reconciliação da subida indexa no Postgres os livros inseridos direto por SQL", async () => {
  const author = await testAuthor();
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${`Livro ${crypto.randomUUID().slice(0, 8)}`}, ${author.id}, '2026-01-01')
    RETURNING id
  ` as { id: number }[];
  await refreshBookVectors();
  const [vector] = await sql`SELECT livro_id FROM livros_vetores WHERE livro_id = ${book!.id}`;
  expect(vector).toBeDefined();
});
