import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  const dimensions = embedder.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida: ${dimensions}`);
  }

  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(22002)`;
    await tx`CREATE TABLE IF NOT EXISTS acervo_indice_vetorial (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      modelo TEXT NOT NULL,
      dimensoes INTEGER NOT NULL
    )`;
    const [model] = await tx`SELECT modelo AS model, dimensoes AS dimensions FROM acervo_indice_vetorial WHERE id = 1`;
    const [column] = await tx`
      SELECT format_type(atttypid, atttypmod) AS type
      FROM pg_attribute
      WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding' AND NOT attisdropped
    `;
    const created = model?.model !== embedder.id || model?.dimensions !== dimensions || column?.type !== `vector(${dimensions})`;

    if (created) {
      await tx`DROP TABLE IF EXISTS livros_vetores`;
      await tx.unsafe(`CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )`);
      await tx`
        INSERT INTO acervo_indice_vetorial (id, modelo, dimensoes)
        VALUES (1, ${embedder.id}, ${dimensions})
        ON CONFLICT (id) DO UPDATE SET modelo = EXCLUDED.modelo, dimensoes = EXCLUDED.dimensoes
      `;
    }
    await tx`CREATE INDEX IF NOT EXISTS livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
    return created;
  }) as boolean;
}

function vectorText(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder): Promise<IndexResult> {
  const result = { indexed: 0, removed: 0 };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;

  const rows = await sql`
    SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "indexedText"
    FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id
    WHERE l.id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number; indexedText: string | null }[];
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (row.indexedText !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    const saved = await sql`
      INSERT INTO livros_vetores (livro_id, texto, embedding)
      SELECT id, ${item.text}, ${vectorText(vectors[i]!)}::vector FROM livros WHERE id = ${item.id}
      FOR KEY SHARE
      ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
      RETURNING livro_id
    `;
    result.indexed += saved.length;
  }
  return result;
}

export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder || ids.length === 0) return { indexed: 0, removed: 0 };
  try {
    const created = await ensureBookIndex(embedder);
    const result = await syncIds(ids, integration, embedder);
    if (created) await reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    await ensureBookIndex(embedder);
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    return await syncIds(rows.map((row) => row.id), integration, embedder);
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

export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = vectorText(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
