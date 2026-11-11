import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function comoTextoDoPgvector(vetor: Float32Array): string {
  return `[${Array.from(vetor).join(",")}]`;
}

/**
 * Garante que a tabela livros_vetores existe para este embedder e diz se precisou criá-la.
 * Vetores de outro modelo não se comparam com os deste: trocar de modelo apaga a
 * tabela e começa de novo.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  await sql`
    CREATE TABLE IF NOT EXISTS livros_vetores_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      modelo TEXT NOT NULL,
      dimensoes INTEGER NOT NULL
    )
  `;

  const meta = await sql`
    SELECT modelo, dimensoes FROM livros_vetores_meta WHERE id = 1
  ` as { modelo: string; dimensoes: number }[];

  const [table] = await sql`
    SELECT to_regclass('livros_vetores') AS regclass
  ` as { regclass: string | null }[];

  if (
    meta.length > 0 &&
    table?.regclass &&
    meta[0]!.modelo === embedder.id &&
    meta[0]!.dimensoes === embedder.dimensions
  ) {
    return false;
  }

  await sql`DROP TABLE IF EXISTS livros_vetores CASCADE`;

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      v vector(${Number(embedder.dimensions)}) NOT NULL
    )
  `);

  await sql`
    CREATE INDEX IF NOT EXISTS livros_vetores_v_idx
    ON livros_vetores USING hnsw (v vector_cosine_ops)
  `;

  await sql`
    INSERT INTO livros_vetores_meta (id, modelo, dimensoes)
    VALUES (1, ${embedder.id}, ${embedder.dimensions})
    ON CONFLICT (id) DO UPDATE
      SET modelo = EXCLUDED.modelo, dimensoes = EXCLUDED.dimensoes
  `;

  return true;
}

export const ensureBookIndex = ensureBookVectors;

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
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
  if (unique.length === 0) return result;

  if (embedder) {
    result.created = await ensureBookVectors(embedder);
  }

  const rows = await sql`
    SELECT id, titulo AS title, autor_id AS "authorId"
    FROM livros
    WHERE id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number }[];

  // remover não precisa de embedder: o livro saiu do Postgres, sai do índice
  const existing = new Set(rows.map((row) => row.id));
  const missing = unique.filter((id) => !existing.has(id));
  if (missing.length > 0) {
    const removed = await sql`
      DELETE FROM livros_vetores WHERE livro_id IN ${sql(missing)} RETURNING livro_id
    `.catch(() => []) as { livro_id: number }[];
    result.removed = removed.length;
  }

  if (!embedder || rows.length === 0) return result;

  const saved = await sql`
    SELECT livro_id AS id, texto
    FROM livros_vetores
    WHERE livro_id IN ${sql(rows.map((r) => r.id))}
  ` as { id: number; texto: string }[];
  const savedMap = new Map(saved.map((s) => [s.id, s.texto]));

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const author = await integration.author(sql, row.authorId);
    const text = indexText(row.title, author?.name);
    if (savedMap.get(row.id) !== text) {
      pending.push({ id: row.id, text });
    }
  }

  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    const vector = vectors[i]!;
    const pgVector = comoTextoDoPgvector(vector);
    await sql`
      INSERT INTO livros_vetores (livro_id, texto, v)
      SELECT ${item.id}, ${item.text}, ${pgVector}::vector
      WHERE EXISTS (SELECT 1 FROM livros WHERE id = ${item.id})
      ON CONFLICT (livro_id) DO UPDATE
        SET texto = EXCLUDED.texto, v = EXCLUDED.v
    `;
  }

  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza o índice para estes livros, depois do COMMIT. Nunca lança: sem Postgres
 * ou sem Gemini o livro fica fora do índice até a próxima reconciliação, e a
 * escrita no Postgres, que é o que importa, já aconteceu.
 */
export async function syncBookIndex(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
  _client?: unknown,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    if (created) await reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** Compara o índice inteiro com o Postgres: indexa o que falta e remove o que sobrou. */
export async function reconcileBookIndex(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
  _client?: unknown,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    const { created: _created, ...result } = await syncIds(rows.map((row) => row.id), integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo reindexa os livros dele. */
export async function syncAuthorBookIndex(
  authorId: number,
  integration: CatalogIntegration,
): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

/** Os `limit` livros mais próximos do vetor de consulta via pgvector (<=>). */
export async function knnSearch(
  vector: Float32Array,
  limit: number,
  _client?: unknown,
): Promise<KnnHit[]> {
  const query = comoTextoDoPgvector(vector);
  const rows = await sql`
    SELECT livro_id AS id, (v <=> ${query}::vector) AS distance
    FROM livros_vetores
    ORDER BY v <=> ${query}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];

  return rows.map((row) => ({ id: Number(row.id), distance: Number(row.distance) }));
}
