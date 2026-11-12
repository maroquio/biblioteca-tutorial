import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** Converte o Float32Array no formato literal aceito pelo pgvector: "[0.1,0.2,...]". */
export function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/**
 * Garante que a tabela livros_vetores e o índice HNSW existem para este embedder.
 * Se o modelo ou a dimensão mudarem, descarta a tabela anterior e recria tudo.
 * Devolve true se precisou criar ou recriar a estrutura.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  const [meta] = await sql`
    SELECT
      to_regclass('livros_vetores') IS NOT NULL AS exists,
      obj_description(to_regclass('livros_vetores'), 'pg_class') AS "modelId",
      (
        SELECT format_type(atttypid, atttypmod)
        FROM pg_attribute
        WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
      ) AS "type"
  ` as { exists: boolean; modelId: string | null; type: string | null }[];

  const expectedType = `vector(${embedder.dimensions})`;
  if (meta?.exists && meta.modelId === embedder.id && meta.type === expectedType) {
    return false;
  }

  if (!Number.isInteger(embedder.dimensions) || embedder.dimensions < 1 || embedder.dimensions > 2000) {
    throw new Error(`Dimensão inválida: ${embedder.dimensions}`);
  }

  if (meta?.exists) {
    await sql.unsafe("DROP TABLE IF EXISTS livros_vetores CASCADE");
  }

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      embedding vector(${embedder.dimensions}) NOT NULL
    )
  `);
  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS livros_vetores_embedding_idx
    ON livros_vetores USING hnsw (embedding vector_cosine_ops)
  `);
  const safeId = embedder.id.replace(/'/g, "''");
  await sql.unsafe(`COMMENT ON TABLE livros_vetores IS '${safeId}'`);
  return true;
}

async function syncIds(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder,
): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;

  result.created = await ensureBookVectors(embedder);

  const rows = await sql`
    SELECT id, titulo AS title, autor_id AS "authorId"
    FROM livros
    WHERE id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number }[];

  // Livros já ausentes em `livros` são removidos da tabela de vetores (caso não tenham sido pelo CASCADE)
  const existing = new Set(rows.map((row) => row.id));
  const removedIds = unique.filter((id) => !existing.has(id));
  if (removedIds.length > 0) {
    const deleted = await sql`
      DELETE FROM livros_vetores WHERE livro_id IN ${sql(removedIds)} RETURNING livro_id
    ` as { livro_id: number }[];
    result.removed = deleted.length;
  }

  if (rows.length === 0) return result;

  // Busca os textos guardados dos livros solicitados
  const existingRows = await sql`
    SELECT livro_id AS "livroId", texto
    FROM livros_vetores
    WHERE livro_id IN ${sql(rows.map((r) => r.id))}
  ` as { livroId: number; texto: string }[];
  const existingTexts = new Map(existingRows.map((r) => [r.livroId, r.texto]));

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const author = await integration.author(sql, row.authorId);
    const text = indexText(row.title, author?.name);
    if (existingTexts.get(row.id) !== text) {
      pending.push({ id: row.id, text });
    }
  }

  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    const vector = vectors[i]!;
    const vectorText = toPgvector(vector);
    await sql`
      INSERT INTO livros_vetores (livro_id, texto, embedding)
      VALUES (${item.id}, ${item.text}, ${vectorText}::vector)
      ON CONFLICT (livro_id) DO UPDATE
        SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
    `;
  }
  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza os vetores destes livros após o COMMIT.
 * Nunca lança: se o embedder falhar, a operação de escrita no Postgres já ocorreu.
 */
export async function syncBookVectors(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    if (created) await reconcileBookVectors(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** Reconcilia a tabela de vetores inteira a partir da tabela livros. */
export async function reconcileBookVectors(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    const ids = rows.map((r) => r.id);
    const { created, ...result } = await syncIds(ids, integration, embedder);
    const cleaned = await sql`
      DELETE FROM livros_vetores WHERE livro_id NOT IN (SELECT id FROM livros) RETURNING livro_id
    ` as { livro_id: number }[];
    result.removed += cleaned.length;
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo reindexa os livros dele. */
export async function syncAuthorBookVectors(
  authorId: number,
  integration: CatalogIntegration,
): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookVectors(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

/** Retorna os `limit` livros mais próximos do vetor de busca pelo operador de distância cosseno `<=>`. */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgvector(vector);
  const rows = await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];
  return rows;
}

// Aliases para manter compatibilidade com as assinaturas anteriores
export const ensureBookIndex = ensureBookVectors;
export const syncBookIndex = syncBookVectors;
export const reconcileBookIndex = reconcileBookVectors;
export const syncAuthorBookIndex = syncAuthorBookVectors;
