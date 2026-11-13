import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogAuthor, CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

function toPgVector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function createTableAndIndex(dimensions: number): Promise<void> {
  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        v vector(${dimensions}) NOT NULL,
        modelo TEXT NOT NULL
      )
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS livros_vetores_v_idx ON livros_vetores USING hnsw (v vector_cosine_ops)
    `);
  } catch (error) {
    if (!/already exists|duplicate key/i.test((error as Error).message)) {
      throw error;
    }
  }
}

export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  if (!Number.isInteger(embedder.dimensions) || embedder.dimensions < 1 || embedder.dimensions > 2000) {
    throw new Error(`Dimensão inválida: ${embedder.dimensions}`);
  }

  const rows = await sql`
    SELECT format_type(atttypid, atttypmod) AS tipo
    FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'v'
  ` as { tipo: string }[];

  if (rows.length === 0) {
    await createTableAndIndex(embedder.dimensions);
    return true;
  }

  const expectedType = `vector(${embedder.dimensions})`;
  if (rows[0]!.tipo !== expectedType) {
    await sql.unsafe(`
      DROP TABLE IF EXISTS livros_vetores CASCADE;
      CREATE TABLE IF NOT EXISTS livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        v vector(${embedder.dimensions}) NOT NULL,
        modelo TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS livros_vetores_v_idx ON livros_vetores USING hnsw (v vector_cosine_ops);
    `);
    return true;
  }

  const diff = await sql`SELECT 1 FROM livros_vetores WHERE modelo != ${embedder.id} LIMIT 1`;
  if (diff.length > 0) {
    await sql.unsafe(`
      DROP TABLE IF EXISTS livros_vetores CASCADE;
      CREATE TABLE IF NOT EXISTS livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        v vector(${embedder.dimensions}) NOT NULL,
        modelo TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS livros_vetores_v_idx ON livros_vetores USING hnsw (v vector_cosine_ops);
    `);
    return true;
  }

  return false;
}

export const ensureBookIndex = ensureBookVectors;

async function syncIds(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null,
): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;

  const rows = await sql`
    SELECT id, titulo AS title, autor_id AS "authorId"
    FROM livros
    WHERE id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number }[];

  const existing = new Set(rows.map((row) => row.id));
  const missing = unique.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    const deleted = await sql`
      DELETE FROM livros_vetores
      WHERE livro_id IN ${sql(missing)}
      RETURNING livro_id
    ` as { livro_id: number }[];
    result.removed += deleted.length;
  }

  if (!embedder || rows.length === 0) return result;

  result.created = await ensureBookVectors(embedder);

  const existingVectors = await sql`
    SELECT livro_id AS "bookId", texto AS text
    FROM livros_vetores
    WHERE livro_id IN ${sql(rows.map((r) => r.id))}
  ` as { bookId: number; text: string }[];
  const textByBookId = new Map(existingVectors.map((r) => [r.bookId, r.text]));

  const authorCache = new Map<number, Promise<CatalogAuthor | null>>();
  const getAuthor = (id: number) => {
    let p = authorCache.get(id);
    if (!p) {
      p = integration.author(sql, id);
      authorCache.set(id, p);
    }
    return p;
  };

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const author = await getAuthor(row.authorId);
    const text = indexText(row.title, author?.name);
    if (textByBookId.get(row.id) !== text) {
      pending.push({ id: row.id, text });
    }
  }

  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  await Promise.all(
    pending.map(async (item, i) => {
      const vector = vectors[i]!;
      await sql`
        INSERT INTO livros_vetores (livro_id, texto, v, modelo)
        SELECT ${item.id}, ${item.text}, ${toPgVector(vector)}::vector, ${embedder.id}
        WHERE EXISTS (SELECT 1 FROM livros WHERE id = ${item.id})
        ON CONFLICT (livro_id) DO UPDATE
          SET texto = EXCLUDED.texto, v = EXCLUDED.v, modelo = EXCLUDED.modelo
      `;
    }),
  );

  result.indexed = pending.length;
  return result;
}

export async function syncBookVectors(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    if (created && embedder) void reconcileBookVectors(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

export const syncBookIndex = syncBookVectors;

export async function reconcileBookVectors(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    await ensureBookVectors(embedder);
    const bookRows = await sql`SELECT id FROM livros` as { id: number }[];
    const vectorRows = await sql`SELECT livro_id FROM livros_vetores` as { livro_id: number }[];
    const allIds = [...new Set([...bookRows.map((r) => r.id), ...vectorRows.map((r) => r.livro_id)])];
    const { created, ...result } = await syncIds(allIds, integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

export const reconcileBookIndex = reconcileBookVectors;

export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookVectors(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const queryVector = toPgVector(vector);
  const rows = await sql`
    SELECT livro_id AS id, (v <=> ${queryVector}::vector) AS distance
    FROM livros_vetores
    ORDER BY v <=> ${queryVector}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];
  return rows;
}
