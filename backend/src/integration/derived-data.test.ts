import { expect, test } from "bun:test";
import { testAuthor, testIsbn } from "#tests/api";
import { sql } from "../infrastructure/postgres";
import { createRedis, ready } from "../infrastructure/redis";
import { refreshBookVectors, refreshRedisDerivedDataOnConnect } from "./derivedData";

test("cada conexão ao Redis atualiza apenas os derivados que ainda vivem nele", async () => {
  const client = createRedis(process.env.REDIS_URL!);
  let refreshes = 0;
  refreshRedisDerivedDataOnConnect(client, async () => { refreshes++; });
  await ready(client);
  for (let i = 0; i < 50 && refreshes === 0; i++) await Bun.sleep(10);
  expect(refreshes).toBe(1);
  client.close();
});

test("a subida pode reconciliar vetores sem depender do Redis", async () => {
  const author = await testAuthor();
  const title = `Subida ${crypto.randomUUID().slice(0, 8)}`;
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-11-14')
    RETURNING id
  ` as { id: number }[];
  await sql`DELETE FROM livros_vetores WHERE livro_id = ${book!.id}`;

  await refreshBookVectors();

  const [vector] = await sql`SELECT texto AS text FROM livros_vetores WHERE livro_id = ${book!.id}` as { text: string }[];
  expect(vector?.text).toBe(`${title} — ${author.nome}`);
});
