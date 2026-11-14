import { expect, test } from "bun:test";
import { testAuthor, testIsbn } from "#tests/api";
import { sql } from "../infrastructure/postgres";
import { createRedis, ready } from "../infrastructure/redis";
import { refreshDerivedData, refreshDerivedDataOnConnect } from "./derivedData";

test("cada conexão ao Redis recalcula os dados derivados", async () => {
  const client = createRedis(process.env.REDIS_URL!);
  let refreshes = 0;
  refreshDerivedDataOnConnect(client, async () => { refreshes++; });
  await ready(client);
  for (let i = 0; i < 50 && refreshes === 0; i++) await Bun.sleep(10);
  expect(refreshes).toBe(1);
  client.close();
});

test("depois do seed, refreshDerivedData dá vetor aos livros gravados direto nas tabelas", async () => {
  const author = await testAuthor();
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${`Do seed ${crypto.randomUUID().slice(0, 8)}`}, ${author.id}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  try {
    await refreshDerivedData();
    const rows = await sql`SELECT 1 FROM livros_vetores WHERE livro_id = ${book!.id}`;
    expect(rows.length).toBe(1);
  } finally {
    await sql`DELETE FROM livros WHERE id = ${book!.id}`;
  }
});
