import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogDb, CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no PostgreSQL, com a extensão pgvector. Uma linha por livro:
 * o texto indexado (título + autor), o modelo que o transformou em vetor e o
 * vetor em si. Tudo aqui é derivado de `livros`: pode ser apagado e refeito.
 *
 * Diferente do Redis, a tabela tem chave estrangeira para `livros` com
 * ON DELETE CASCADE: excluir o livro leva o vetor junto, na mesma transação, e
 * não existem vetores órfãos. O que pode faltar é vetor de livro, e a
 * reconciliação cuida disso.
 */
/** O índice HNSW do pgvector aceita no máximo 2000 dimensões para o tipo vector. */
const MAX_DIMENSIONS = 2000;

/** Quantos livros cada rodada de sincronização lê, compara e embeda de uma vez. */
const BATCH_SIZE = 500;

export type IndexResult = { indexed: number };
export type KnnHit = { id: number; distance: number };

/** O formato de texto do pgvector: "[0.9,0.1,0]". O ::vector da consulta faz a conversão. */
export function toVectorLiteral(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
export function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/**
 * Cria a extensão `vector` neste banco. É por banco, não por servidor, e pode
 * rodar quantas vezes for preciso. Passa pelo lock das escritas para duas
 * subidas ao mesmo tempo não brigarem pelo mesmo CREATE EXTENSION.
 */
export async function prepareVectorExtension(): Promise<void> {
  await inTransaction(async (tx) => {
    await tx`CREATE EXTENSION IF NOT EXISTS vector`;
  });
}

type TableState = "ok" | "missing-index" | "stale";

/**
 * Compara a tabela com o embedder. "stale" quer dizer que ela não existe ou foi
 * feita por outro modelo (outra dimensão ou outro id): os vetores dela não
 * se comparam com os deste embedder.
 */
async function inspectTable(db: CatalogDb, embedder: Embedder): Promise<TableState> {
  const [column] = await db`
    SELECT format_type(atttypid, atttypmod) AS type
    FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding' AND NOT attisdropped
  ` as { type: string }[];
  if (column?.type !== `vector(${embedder.dimensions})`) return "stale";

  const [otherModel] = await db`SELECT 1 AS found FROM livros_vetores WHERE modelo <> ${embedder.id} LIMIT 1`;
  if (otherModel) return "stale";

  const [index] = await db`SELECT to_regclass('livros_vetores_embedding_idx') IS NOT NULL AS found` as { found: boolean }[];
  return index!.found ? "ok" : "missing-index";
}

async function createVectorIndex(db: CatalogDb): Promise<void> {
  await db`CREATE INDEX IF NOT EXISTS livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
}

async function recreateTable(db: CatalogDb, dimensions: number): Promise<void> {
  // a dimensão faz parte do tipo, e não é um valor: vector($1) é erro de sintaxe.
  // Por isso o texto vai cru (unsafe), e só depois de provar que é um número.
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o índice HNSW: ${dimensions}`);
  }
  await db`DROP TABLE IF EXISTS livros_vetores`;
  await db.unsafe(`
    CREATE TABLE livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      modelo TEXT NOT NULL,
      texto TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL
    )
  `);
  await createVectorIndex(db);
}

/**
 * Garante que a tabela e o índice existem para este embedder e diz se precisou
 * criar a tabela do zero (primeira vez, ou modelo trocado). Quem recebe `true`
 * sabe que a tabela está vazia e dispara a reconciliação.
 *
 * A tabela não nasce no prepareDatabase porque a dimensão depende do embedder
 * (1024 nos testes, 768 com o Gemini), e o embedder pode nem existir.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  // caminho comum: nada a fazer, e sem esperar o lock das escritas
  if (await inspectTable(sql, embedder) === "ok") return false;

  return await inTransaction(async (tx) => {
    // outra requisição pode ter arrumado a tabela enquanto esperávamos o lock
    const state = await inspectTable(tx, embedder);
    if (state === "ok") return false;
    if (state === "missing-index") {
      await createVectorIndex(tx);
      return false;
    }
    await recreateTable(tx, embedder.dimensions);
    return true;
  });
}

type BookForIndex = { id: number; title: string; authorId: number };

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0 || !embedder) return result;

  let ensured = false;
  for (let start = 0; start < unique.length; start += BATCH_SIZE) {
    const batch = unique.slice(start, start + BATCH_SIZE);
    // o livro excluído leva o vetor junto (CASCADE): aqui só entra quem ainda existe
    const books = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(batch)}` as BookForIndex[];
    if (books.length === 0) continue;

    if (!ensured) {
      result.created = await ensureBookVectors(embedder);
      ensured = true;
    }

    const stored = await sql`SELECT livro_id AS id, texto AS text FROM livros_vetores WHERE livro_id IN ${sql(books.map((book) => book.id))}` as { id: number; text: string }[];
    const storedText = new Map(stored.map((row) => [row.id, row.text]));

    // só paga o embedding de quem não tem vetor ou cujo texto mudou
    const authorNames = new Map<number, string | undefined>();
    const pending: { id: number; text: string }[] = [];
    for (const book of books) {
      if (!authorNames.has(book.authorId)) authorNames.set(book.authorId, (await integration.author(sql, book.authorId))?.name);
      const text = indexText(book.title, authorNames.get(book.authorId));
      if (storedText.get(book.id) !== text) pending.push({ id: book.id, text });
    }
    if (pending.length === 0) continue;

    const vectors = await embedder.embed(pending.map((item) => item.text), "document");
    for (const [i, item] of pending.entries()) {
      // upsert. O SELECT ... FROM livros faz o INSERT valer só se o livro ainda existir:
      // se ele foi excluído enquanto o Gemini respondia, não sobra erro de chave estrangeira
      await sql`
        INSERT INTO livros_vetores (livro_id, modelo, texto, embedding)
        SELECT id, ${embedder.id}::text, ${item.text}::text, ${toVectorLiteral(vectors[i]!)}::vector
        FROM livros WHERE id = ${item.id}
        ON CONFLICT (livro_id) DO UPDATE
          SET modelo = EXCLUDED.modelo, texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
      `;
    }
    result.indexed += pending.length;
  }
  return result;
}

/** Reconciliações disparadas em segundo plano: a busca e a escrita não esperam por elas. */
const background = new Set<Promise<unknown>>();

/** Reconstrói a tabela recém-criada sem segurar quem pediu: responde com o que houver. */
export function reconcileInBackground(integration: CatalogIntegration, embedder: Embedder): void {
  const task = reconcileBookIndex(integration, embedder);
  background.add(task);
  const done = () => { background.delete(task); };
  void task.then(done, done);
}

/** Espera as reconciliações em segundo plano. Serve aos testes que trocam de embedder. */
export async function settleBookIndex(): Promise<void> {
  while (background.size > 0) await Promise.allSettled([...background]);
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: se o Gemini
 * ou o banco falharem, o livro fica sem vetor até a próxima reconciliação, e a
 * escrita em `livros`, que é o que importa, já aconteceu.
 *
 * Nunca chame isto dentro de inTransaction: todas as escritas esperam o mesmo
 * lock, e uma chamada ao Gemini lá dentro seguraria a biblioteca inteira.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (primeira vez, modelo trocado): os outros livros também precisam entrar
    if (created && embedder) reconcileInBackground(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/**
 * Passa todos os livros pela sincronização: quem não tem vetor (o seed escreve
 * direto em `livros`, o Gemini estava fora do ar) ou tem texto desatualizado
 * ganha vetor novo, e quem está em dia é pulado sem chamar o embedder.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0 };
  try {
    const rows = await sql`SELECT id FROM livros ORDER BY id` as { id: number }[];
    const { indexed } = await syncIds(rows.map((row) => row.id), integration, embedder);
    return { indexed };
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo reindexa os livros dele. */
export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

/**
 * Os `limit` livros mais próximos do vetor, do mais perto para o mais longe.
 * `<=>` é a distância cosseno (1 − cos θ), a mesma do Redis, e o ORDER BY com
 * essa expressão é o que o índice HNSW de vector_cosine_ops sabe acelerar.
 */
export async function nearestBooks(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toVectorLiteral(vector);
  const rows = await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];
  return rows.map((row) => ({ id: Number(row.id), distance: Number(row.distance) }));
}
