import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/**
 * Converte Float32Array para o formato textual aceito pelo pgvector: "[0.1,0.2,...]".
 */
export function toPgVector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/**
 * Garante que a tabela livros_vetores existe para este embedder e diz se precisou criá-la.
 * Se o modelo ou a dimensão mudaram, a tabela é recriada.
 */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  if (!Number.isInteger(embedder.dimensions) || embedder.dimensions < 1 || embedder.dimensions > 2000) {
    throw new Error(`Dimensão inválida: ${embedder.dimensions}`);
  }

  const rows = await sql`
    SELECT
      format_type(atttypid, atttypmod) AS tipo,
      obj_description(to_regclass('livros_vetores'), 'pg_class') AS modelo
    FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'v'
  ` as { tipo: string | null; modelo: string | null }[];

  if (rows.length > 0) {
    const row = rows[0]!;
    if (row.tipo === `vector(${embedder.dimensions})` && row.modelo === embedder.id) {
      return false;
    }
    await sql.unsafe(`DROP TABLE IF EXISTS livros_vetores CASCADE`);
  }

  try {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        v vector(${embedder.dimensions}) NOT NULL
      )
    `);
    await sql.unsafe(`
      CREATE INDEX IF NOT EXISTS livros_vetores_v_idx ON livros_vetores USING hnsw (v vector_cosine_ops)
    `);
    await sql.unsafe(`
      COMMENT ON TABLE livros_vetores IS '${embedder.id.replaceAll("'", "''")}'
    `);
  } catch (error) {
    if (!/already exists|duplicate key/i.test((error as Error).message)) {
      throw error;
    }
  }

  return true;
}

export const ensureBookVectors = ensureBookIndex;

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

  result.created = await ensureBookIndex(embedder);

  const storedTexts = new Map<number, string>();
  if (!result.created) {
    const bookIds = rows.map((r) => r.id);
    const stored = await sql`
      SELECT livro_id AS "livroId", texto
      FROM livros_vetores
      WHERE livro_id IN ${sql(bookIds)}
    ` as { livroId: number; texto: string }[];
    for (const s of stored) storedTexts.set(s.livroId, s.texto);
  }

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const author = await integration.author(sql, row.authorId);
    const text = indexText(row.title, author?.name);
    if (storedTexts.get(row.id) !== text) {
      pending.push({ id: row.id, text });
    }
  }

  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    const vector = vectors[i]!;
    try {
      await sql`
        INSERT INTO livros_vetores (livro_id, texto, v)
        SELECT id, ${item.text}, ${toPgVector(vector)}::vector
        FROM livros
        WHERE id = ${item.id}
        ON CONFLICT (livro_id) DO UPDATE
          SET texto = EXCLUDED.texto, v = EXCLUDED.v
      `;
    } catch (err) {
      if (!/foreign key/i.test((err as Error).message)) throw err;
    }
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
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    if (created && embedder) void reconcileBookIndex(integration, embedder);
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
  try {
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    const { created, ...result } = await syncIds(rows.map((row) => row.id), integration, embedder);
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

/** Os `limit` livros mais próximos do vetor, do mais perto para o mais longe. */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgVector(vector);
  const rows = await sql`
    SELECT livro_id AS id, v <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY v <=> ${query}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];
  return rows;
}
