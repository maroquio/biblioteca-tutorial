import type { TransactionSQL } from "bun";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no próprio Postgres, com o pgvector. Uma linha por livro em
 * `livros_vetores`, com o texto indexado e o vetor; o índice HNSW (distância
 * cosseno) acha os vizinhos mais próximos de uma consulta. Tudo aqui é derivado
 * de `livros`: pode ser apagado e reconstruído a qualquer momento.
 *
 * A dimensão da coluna depende do embedder (1024 no hash, 768 no Gemini), por isso
 * a tabela não nasce no prepareCatalog: ensureBookVectors a cria no primeiro uso e
 * a recria quando o modelo muda. `livros_vetores_modelo` lembra qual embedder a criou.
 */

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** Um lock só da tabela de vetores: não disputa a fila das escritas (22001). */
const VECTORS_LOCK = 22024;

/** O limite de dimensões do índice HNSW para o tipo vector. */
const MAX_HNSW_DIMENSIONS = 2000;

/** Chamada pelo prepareCatalog: a extensão e os metadados não dependem do embedder. */
export async function prepareBookVectors(tx: TransactionSQL): Promise<void> {
  await tx`CREATE EXTENSION IF NOT EXISTS vector`;
  await tx`CREATE TABLE IF NOT EXISTS livros_vetores_modelo (
    unico BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (unico),
    modelo TEXT NOT NULL
  )`;
}

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function toPgVector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

async function currentModel(db: TransactionSQL | typeof sql): Promise<string | null> {
  const [row] = await db`
    SELECT m.modelo FROM livros_vetores_modelo m
    WHERE to_regclass('public.livros_vetores') IS NOT NULL
  ` as { modelo: string }[];
  return row?.modelo ?? null;
}

/**
 * Garante que a tabela existe para este embedder e diz se precisou criá-la.
 * Vetores de outro modelo não se comparam com os deste: trocar de modelo apaga a
 * tabela e começa de novo, com a dimensão nova.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  // caminho rápido, sem lock: quase sempre a tabela já é deste embedder
  if (await currentModel(sql) === embedder.id) return false;

  const dimensions = embedder.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_HNSW_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o índice HNSW: ${dimensions}`);
  }
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${VECTORS_LOCK})`;
    // outra requisição pode ter criado a tabela enquanto esta esperava o lock
    if (await currentModel(tx) === embedder.id) return false;
    await tx`DROP TABLE IF EXISTS livros_vetores`;
    // DDL não aceita parâmetro: a dimensão entra no texto, já validada como inteiro
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )
    `);
    await tx`CREATE INDEX livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
    await tx`
      INSERT INTO livros_vetores_modelo (unico, modelo) VALUES (TRUE, ${embedder.id})
      ON CONFLICT (unico) DO UPDATE SET modelo = EXCLUDED.modelo
    `;
    return true;
  }) as boolean;
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  // livro excluído não precisa de nada: o ON DELETE CASCADE levou o vetor junto
  if (unique.length === 0 || !embedder) return result;

  result.created = await ensureBookVectors(embedder);
  const rows = await sql`
    SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "storedText"
    FROM livros l
    LEFT JOIN livros_vetores v ON v.livro_id = l.id
    WHERE l.id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number; storedText: string | null }[];

  // só paga o embedding quando o texto mudou (ou o livro ainda não tem vetor)
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (row.storedText !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // o livro pode ter sido excluído enquanto o embedder respondia: aí não há o que gravar
    const written = await sql`
      INSERT INTO livros_vetores (livro_id, texto, embedding)
      SELECT id, ${item.text}, ${toPgVector(vectors[i]!)}::vector FROM livros WHERE id = ${item.id}
      ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
      RETURNING livro_id
    `;
    result.indexed += written.length;
  }
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini o
 * livro fica sem vetor até a próxima reconciliação, e a escrita do livro, que é o
 * que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (primeiro uso, modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/**
 * Dá vetor aos livros que não têm (o seed escreve direto em `livros`; o Gemini
 * estava fora do ar) e refaz os de texto desatualizado. Órfãos não existem: a
 * chave estrangeira não deixa.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const ids = (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id);
    const { created, ...result } = await syncIds(ids, integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
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
 * O par ORDER BY <=> ... LIMIT é o KNN que o índice HNSW sabe acelerar; a
 * distância é 1 − cos(θ), a mesma do Redis, então o limiar não muda.
 */
export async function nearestBookVectors(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgVector(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
