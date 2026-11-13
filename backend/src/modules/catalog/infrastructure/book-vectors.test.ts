import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn, testName } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

type VectorRow = { text: string; dims: number; vector: string };

async function storedVector(bookId: number): Promise<VectorRow | undefined> {
  const [row] = await sql`
    SELECT texto AS text, vector_dims(embedding) AS dims, embedding::text AS vector
    FROM livros_vetores
    WHERE livro_id = ${bookId}
  ` as VectorRow[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

test("UC24: cadastrar livro grava texto 'Título — Autor' e vetor na dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const row = await storedVector(book.id);
  expect(row).toBeDefined();
  expect(row!.text).toBe(`${title} — ${author.nome}`);
  expect(row!.dims).toBe(createHashEmbedder().dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const before = await storedVector(book.id);

  const newTitle = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  const res = await api("PUT", `/livros/${book.id}`, {
    isbn: book.isbn,
    titulo: newTitle,
    autorId: author.id,
  });
  expect(res.status).toBe(200);

  const after = await storedVector(book.id);
  expect(after).toBeDefined();
  expect(after!.text).toBe(`${newTitle} — ${author.nome}`);
  expect(after!.vector).not.toBe(before!.vector);
});

test("UC24: excluir o livro remove a linha de vetor via CASCADE", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  expect(await storedVector(book.id)).toBeDefined();

  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await storedVector(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto e o vetor dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newName = `Autora ${crypto.randomUUID().slice(0, 8)}`;

  expect((await api("PUT", `/autores/${author.id}`, { nome: newName, tipo: "literatura" })).status).toBe(200);
  const row = await storedVector(book.id);
  expect(row).toBeDefined();
  expect(row!.text).toEndWith(`— ${newName}`);
});

test("UC24: livro inserido direto com SQL ganha vetor depois da reconciliação", async () => {
  const author = await testAuthor();
  const title = testName("LivroSQL");
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-11-13')
    RETURNING id
  ` as { id: number }[];

  expect(await storedVector(inserted!.id)).toBeUndefined();

  await reconcileBookIndex(catalogIntegration);

  const row = await storedVector(inserted!.id);
  expect(row).toBeDefined();
  expect(row!.text).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar de novo um livro com o mesmo texto não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);

  const base = createHashEmbedder();
  let calls = 0;
  const counter: Embedder = {
    ...base,
    embed: (texts, purpose) => {
      calls++;
      return base.embed(texts, purpose);
    },
  };

  const result = await syncBookIndex([book.id], catalogIntegration, counter);
  expect(result).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);
});

test("UC24: falha do embedder não lança erro na sincronização", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);

  const base = createHashEmbedder();
  const failing: Embedder = {
    ...base,
    embed: async () => {
      throw new Error("provedor de embeddings fora do ar");
    },
  };

  await sql`DELETE FROM livros_vetores WHERE livro_id = ${book.id}`;
  const result = await syncBookIndex([book.id], catalogIntegration, failing);
  expect(result).toEqual({ indexed: 0, removed: 0 });
});

test("UC24: trocar de embedder (outra dimensão) refaz a tabela e reindexa os livros", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const defaultEmbedder = createHashEmbedder();
  const smallerEmbedder = createHashEmbedder(512);

  try {
    await syncBookIndex([book.id], catalogIntegration, smallerEmbedder);
    const row = await storedVector(book.id);
    expect(row).toBeDefined();
    expect(row!.dims).toBe(512);
  } finally {
    // restaura a tabela na dimensão padrão (1024) para os demais testes da suíte
    await reconcileBookIndex(catalogIntegration, defaultEmbedder);
  }

  const restored = await storedVector(book.id);
  expect(restored).toBeDefined();
  expect(restored!.dims).toBe(defaultEmbedder.dimensions);
});

/*
 * Respostas às questões do Passo 08 (Para discutir):
 *
 * 1. Redis ou pgvector?
 *    Com o pgvector, ganhamos uma única fonte da verdade no Postgres: integridade
 *    referencial com ON DELETE CASCADE (sem vetores órfãos), possibilidade de fazer
 *    JOIN direto com livros/exemplares, persistência no mesmo volume pgdata (sem
 *    precisar reconstruir o índice quando o Redis reinicia) e busca semântica
 *    funcionando mesmo com o Redis fora do ar. Em contrapartida, colocamos mais CPU,
 *    memória e I/O no banco relacional principal e acoplamos a escala do índice
 *    vetorial à do Postgres. Um banco vetorial dedicado voltaria a fazer sentido
 *    com dezenas de milhões de vetores de alta dimensão ou tráfego intenso de buscas
 *    KNN concorrentes disputando memória/CPU com transações OLTP críticas.
 *
 * 2. Por que não dentro da transação?
 *    Em src/infrastructure/transaction.ts, toda transação de escrita adquire o lock
 *    exclusivo pg_advisory_xact_lock(22001), serializando as escritas do sistema.
 *    Chamar a API externa do Gemini (que pode levar segundos ou falhar por rede/cota)
 *    dentro do inTransaction travaria todas as demais escritas da biblioteca e faria
 *    uma falha do provedor de embeddings abortar o cadastro do livro. Para manter os
 *    vetores em dia sem bloquear a transação, pode-se usar o padrão Outbox (gravar
 *    na mesma transação um evento/pendência numa tabela ou fila para um worker em
 *    background processar) combinado com reconciliação periódica.
 *
 * 3. O passo 07 da aula ainda vale?
 *    Quando o Redis reconecta (onconnect), os vetores dos livros já estão seguros e
 *    persistidos no Postgres, então não precisariam ser reindexados por causa do
 *    Redis. O que ainda precisa acontecer quando o Redis volta é invalidar os caches
 *    de busca que moram nele (como invalidateAuthorSearch), pois escritas podem ter
 *    ocorrido enquanto o Redis estava desconectado ou ter caído numa instância que
 *    voltou com estado desatualizado.
 *
 * 4. Aproximado (HNSW e hnsw.ef_search).
 *    O HNSW constrói um grafo navegável em camadas e faz uma busca gulosa aproximada
 *    (ANN), podendo deixar de visitar o vizinho exato em troca de velocidade. Com 50
 *    livros o grafo inteiro cabe com folga na janela de busca (ou o planejador usa
 *    Seq Scan exato), então a diferença prática é nula. Com 5 milhões de livros, o
 *    trade-off entre recall e latência importa muito: o parâmetro hnsw.ef_search
 *    (padrão 40 no pgvector) controla o tamanho da lista dinâmica de candidatos
 *    explorados durante a busca — valores maiores aumentam a precisão (recall) ao
 *    custo de maior tempo de consulta.
 *
 * 5. Filtros ("livros parecidos com mistério, mas só com exemplar disponível").
 *    No pgvector é muito mais natural, pois livros, exemplares e empréstimos já
 *    estão no mesmo banco Postgres: basta combinar a consulta vetorial com um JOIN
 *    ou EXISTS verificando exemplares sem empréstimo ativo na mesma query SQL. No
 *    Redis, seria preciso ou duplicar e manter sincronizado o estado de disponibilidade
 *    de exemplares dentro de cada hash do Redis, ou buscar muitos candidatos no KNN
 *    do Redis e filtrar depois no Postgres (correndo o risco de os K primeiros
 *    estarem todos indisponíveis).
 */

