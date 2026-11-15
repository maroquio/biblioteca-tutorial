import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

const TABLE = "livros_vetores";

const MAX_DIMENSIONS = 2000;

export type IndexResult = { indexed: number };

function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

async function tableModel(): Promise<string | null> {
  const [row] = await sql`SELECT obj_description(to_regclass(${TABLE}), 'pg_class') AS model` as { model: string | null }[];
  return row?.model ?? null;
}

export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  if (await tableModel() === embedder.id) return false;

  const dimensions = embedder.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o pgvector: ${dimensions}`);
  }
  return await inTransaction(async (tx) => {
    const [row] = await tx`SELECT obj_description(to_regclass(${TABLE}), 'pg_class') AS model` as { model: string | null }[];
    if (row?.model === embedder.id) return false;
    await tx`DROP TABLE IF EXISTS livros_vetores`;
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )`);
    await tx`CREATE INDEX livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
    await tx.unsafe(`COMMENT ON TABLE livros_vetores IS '${embedder.id.replaceAll("'", "''")}'`);
    return true;
  });
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

function isForeignKeyViolation(error: unknown): boolean {
  const { errno, code } = error as { errno?: string; code?: string };
  return errno === "23503" || code === "23503";
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0 || !embedder) return result;
  const rows = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;

  result.created = await ensureBookVectors(embedder);
  const stored = await sql`SELECT livro_id AS id, texto AS text FROM livros_vetores WHERE livro_id IN ${sql(rows.map((row) => row.id))}` as { id: number; text: string }[];
  const storedText = new Map(stored.map((row) => [row.id, row.text]));

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (storedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    try {
      await sql`
        INSERT INTO livros_vetores (livro_id, texto, embedding)
        VALUES (${item.id}, ${item.text}, ${toPgvector(vectors[i]!)}::vector)
        ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
      `;
      result.indexed++;
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
    }
  }
  return result;
}

export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const ids = (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id);
    const { created, ...result } = await syncIds(ids, integration, embedder);
    return result;
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

export type KnnHit = { id: number; distance: number };

export async function nearestBookVectors(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgvector(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
