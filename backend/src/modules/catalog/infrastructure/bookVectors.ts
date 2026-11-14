import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

const MAX_HNSW_DIMENSIONS = 2000;

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

function validateDimensions(dimensions: number): void {
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_HNSW_DIMENSIONS) {
    throw new Error(`Dimensão inválida para pgvector: ${dimensions}`);
  }
}

function asPgvectorText(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** Garante que tabela, dimensão, modelo e índice HNSW formam um único esquema coerente. */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  validateDimensions(embedder.dimensions);
  return inTransaction(async (tx) => {
    await tx`
      CREATE TABLE IF NOT EXISTS livros_vetores_configuracao (
        singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
        modelo TEXT NOT NULL,
        dimensoes INTEGER NOT NULL
      )
    `;
    const [configuration] = await tx`
      SELECT modelo AS model, dimensoes AS dimensions
      FROM livros_vetores_configuracao WHERE singleton = TRUE
    ` as { model: string; dimensions: number }[];
    const [column] = await tx`
      SELECT format_type(atttypid, atttypmod) AS type
      FROM pg_attribute
      WHERE attrelid = to_regclass('livros_vetores')
        AND attname = 'embedding' AND NOT attisdropped
    ` as { type: string }[];
    const expectedType = `vector(${embedder.dimensions})`;
    if (configuration?.model === embedder.id
      && configuration.dimensions === embedder.dimensions
      && column?.type === expectedType) {
      return false;
    }

    await tx`DROP TABLE IF EXISTS livros_vetores`;
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        modelo TEXT NOT NULL,
        texto TEXT NOT NULL,
        embedding vector(${embedder.dimensions}) NOT NULL
      )
    `);
    await tx`
      CREATE INDEX livros_vetores_embedding_hnsw_idx
      ON livros_vetores USING hnsw (embedding vector_cosine_ops)
    `;
    await tx`DELETE FROM livros_vetores_configuracao`;
    await tx`
      INSERT INTO livros_vetores_configuracao (singleton, modelo, dimensoes)
      VALUES (TRUE, ${embedder.id}, ${embedder.dimensions})
    `;
    return true;
  });
}

function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function syncIds(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null,
): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0 || !embedder) return result;

  const rows = await sql`
    SELECT id, titulo AS title, autor_id AS "authorId"
    FROM livros WHERE id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;

  result.created = await ensureBookIndex(embedder);
  const stored = await sql`
    SELECT livro_id AS id, texto AS text
    FROM livros_vetores WHERE livro_id IN ${sql(rows.map((row) => row.id))}
  ` as { id: number; text: string }[];
  const storedText = new Map(stored.map((row) => [row.id, row.text]));
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (storedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [index, item] of pending.entries()) {
    const vector = vectors[index];
    if (!vector || vector.length !== embedder.dimensions) {
      throw new Error(`Embedder devolveu dimensão inválida para o livro ${item.id}`);
    }
    await sql`
      INSERT INTO livros_vetores (livro_id, modelo, texto, embedding)
      VALUES (${item.id}, ${embedder.id}, ${item.text}, ${asPgvectorText(vector)}::vector)
      ON CONFLICT (livro_id) DO UPDATE SET
        modelo = EXCLUDED.modelo,
        texto = EXCLUDED.texto,
        embedding = EXCLUDED.embedding
    `;
  }
  result.indexed = pending.length;
  return result;
}

/** Atualiza dados derivados depois do COMMIT e nunca transforma falha externa em falha da escrita. */
export async function syncBookIndex(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** Reprocessa todos os livros; a comparação de texto evita embeddings desnecessários. */
export async function reconcileBookIndex(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const ids = (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id);
    const { created: _created, ...result } = await syncIds(ids, integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

/** Os `limit` livros mais próximos do vetor, do mais perto para o mais longe. */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = asPgvectorText(vector);
  const rows = await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
  return rows.map((row) => ({ id: row.id, distance: Number(row.distance) }));
}
