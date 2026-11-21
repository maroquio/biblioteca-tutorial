import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Tabela de vetores de livros no PostgreSQL com pgvector.
 * Cada livro possui uma linha com o texto indexado, o id do modelo e a coluna vector(N).
 * O índice HNSW acelera a busca de vizinhos mais próximos por distância cosseno.
 */
export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** Formata Float32Array para a sintaxe do pgvector: "[0.9,0.1,0.0]". */
export function comoTextoDoPgvector(vetor: Float32Array): string {
  return `[${Array.from(vetor).join(",")}]`;
}

/**
 * Garante que a tabela livros_vetores existe para este embedder.
 * Se a tabela já existir mas foi criada com outro modelo ou dimensão, apaga e recria.
 * Retorna true se a tabela foi (re)criada.
 */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  const dim = embedder.dimensions;
  if (!Number.isInteger(dim) || dim < 1 || dim > 2000) {
    throw new Error(`Dimensão inválida: ${dim}`);
  }

  // Verifica se a tabela já existe
  const [tableInfo] = await sql`SELECT to_regclass('public.livros_vetores') IS NOT NULL AS "exists"` as { exists: boolean }[];

  if (tableInfo?.exists) {
    // Confere a dimensão da coluna v no catálogo do Postgres
    const [col] = await sql`
      SELECT format_type(atttypid, atttypmod) AS tipo
      FROM pg_attribute
      WHERE attrelid = to_regclass('public.livros_vetores') AND attname = 'v'
    ` as { tipo: string }[];

    // Confere se o modelo de alguma linha existente diverge do embedder atual
    const [modelCheck] = await sql`
      SELECT EXISTS (
        SELECT 1 FROM livros_vetores WHERE modelo <> ${embedder.id}
      ) AS "hasDifferentModel"
    ` as { hasDifferentModel: boolean }[];

    if (col?.tipo === `vector(${dim})` && !modelCheck?.hasDifferentModel) {
      return false;
    }

    // Modelo ou dimensão diferente: recria a tabela
    await sql`DROP TABLE livros_vetores`;
  }

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      modelo TEXT NOT NULL,
      v vector(${dim}) NOT NULL
    )
  `);

  await sql.unsafe(`
    CREATE INDEX IF NOT EXISTS livros_vetores_v_hnsw_idx
    ON livros_vetores USING hnsw (v vector_cosine_ops)
  `);

  return true;
}

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

  const rows = await sql`
    SELECT id, titulo AS title, autor_id AS "authorId"
    FROM livros
    WHERE id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number }[];

  // ON DELETE CASCADE remove automaticamente quando livros são excluídos.
  // Caso livros_vetores exista, removemos qualquer id que não esteja mais em livros.
  const existing = new Set(rows.map((row) => row.id));
  const [tableExists] = await sql`SELECT to_regclass('public.livros_vetores') IS NOT NULL AS "exists"` as { exists: boolean }[];
  if (tableExists?.exists) {
    const toRemove = unique.filter((id) => !existing.has(id));
    if (toRemove.length > 0) {
      const removedRows = await sql`
        DELETE FROM livros_vetores WHERE livro_id IN ${sql(toRemove)} RETURNING livro_id
      ` as { livro_id: number }[];
      result.removed = removedRows.length;
    }
  }

  if (!embedder || rows.length === 0) return result;

  result.created = await ensureBookIndex(embedder);

  // Busca os textos guardados dos livros informados para evitar recalcular
  const storedRows = await sql`
    SELECT livro_id AS id, texto, modelo
    FROM livros_vetores
    WHERE livro_id IN ${sql(rows.map((r) => r.id))}
  ` as { id: number; texto: string; modelo: string }[];
  const storedMap = new Map(storedRows.map((s) => [s.id, s]));

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const author = await integration.author(sql, row.authorId);
    const text = indexText(row.title, author?.name);
    const stored = storedMap.get(row.id);
    if (!stored || stored.texto !== text || stored.modelo !== embedder.id) {
      pending.push({ id: row.id, text });
    }
  }

  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    const vector = vectors[i]!;
    const vectorText = comoTextoDoPgvector(vector);
    await sql`
      INSERT INTO livros_vetores (livro_id, texto, modelo, v)
      VALUES (${item.id}, ${item.text}, ${embedder.id}, ${vectorText}::vector)
      ON CONFLICT (livro_id) DO UPDATE
        SET texto = EXCLUDED.texto,
            modelo = EXCLUDED.modelo,
            v = EXCLUDED.v
    `;
  }

  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza o índice para estes livros, depois do COMMIT.
 * Nunca lança: falhas do embedder deixam o livro fora do índice até a próxima reconciliação.
 */
export async function syncBookIndex(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    if (created && embedder) {
      void reconcileBookIndex(integration, embedder);
    }
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/**
 * Reconcilia o índice com a tabela livros:
 * Livros sem vetor ou com texto desatualizado ganham novo vetor.
 */
export async function reconcileBookIndex(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  try {
    const bookRows = await sql`SELECT id FROM livros` as { id: number }[];
    const ids = bookRows.map((r) => r.id);
    const { created, ...result } = await syncIds(ids, integration, embedder);
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

/** Consulta os vizinhos mais próximos usando operador <=> e ordenação por distância. */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const queryVector = comoTextoDoPgvector(vector);
  const rows = await sql`
    SELECT livro_id AS id, v <=> ${queryVector}::vector AS distance
    FROM livros_vetores
    ORDER BY v <=> ${queryVector}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];

  return rows.map((r) => ({ id: r.id, distance: Number(r.distance) }));
}
