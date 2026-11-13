import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** O formato de texto aceito pelo tipo vector do pgvector: "[0.9,0.1,0]". */
export function toPgVector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/**
 * Garante que a tabela de vetores e o índice HNSW existem para este embedder e
 * diz se precisou (re)criá-los. Vetores de outro modelo ou de outra dimensão não
 * se comparam com os deste: trocar de modelo recria a tabela com a dimensão nova.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  const { dimensions, id: modelId } = embedder;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida para o pgvector: ${dimensions}`);
  }

  const [existing] = await sql`
    SELECT format_type(atttypid, atttypmod) AS type,
           obj_description(attrelid, 'pg_class') AS model
    FROM pg_attribute
    WHERE attrelid = to_regclass('public.livros_vetores')
      AND attname = 'embedding'
  ` as { type: string; model: string | null }[];

  if (existing) {
    const sameDimension = existing.type === `vector(${dimensions})`;
    const sameComment = existing.model === modelId;
    const [differentRow] = sameDimension
      ? await sql`SELECT 1 FROM livros_vetores WHERE modelo <> ${modelId} LIMIT 1`
      : [{ "?column?": 1 }];
    if (sameDimension && sameComment && !differentRow) {
      return false;
    }
    await sql`DROP TABLE IF EXISTS livros_vetores`;
  }

  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      modelo TEXT NOT NULL,
      texto TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL
    )
  `);
  await sql`
    CREATE INDEX IF NOT EXISTS livros_vetores_embedding_idx
      ON livros_vetores USING hnsw (embedding vector_cosine_ops)
  `;
  await sql.unsafe(`COMMENT ON TABLE livros_vetores IS '${modelId.replaceAll("'", "''")}'`);
  return true;
}

async function syncIds(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null,
): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  if (!embedder || unique.length === 0) return result;

  result.created = await ensureBookVectors(embedder);

  const rows = await sql`
    SELECT id, titulo AS title, autor_id AS "authorId"
    FROM livros
    WHERE id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;

  const storedRows = await sql`
    SELECT livro_id AS id, texto AS text
    FROM livros_vetores
    WHERE livro_id IN ${sql(rows.map((row) => row.id))}
      AND modelo = ${embedder.id}
  ` as { id: number; text: string }[];
  const storedTextById = new Map(storedRows.map((row) => [row.id, row.text]));

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    // só calcula o embedding quando o livro ainda não tem vetor ou o texto mudou
    if (storedTextById.get(row.id) !== text) {
      pending.push({ id: row.id, text });
    }
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    const vectorLiteral = toPgVector(vectors[i]!);
    await sql`
      INSERT INTO livros_vetores (livro_id, modelo, texto, embedding)
      VALUES (${item.id}, ${embedder.id}, ${item.text}, ${vectorLiteral}::vector)
      ON CONFLICT (livro_id) DO UPDATE
        SET modelo = EXCLUDED.modelo,
            texto = EXCLUDED.texto,
            embedding = EXCLUDED.embedding
    `;
  }
  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: se o Gemini
 * falhar ou não houver embedder, o livro fica sem vetor até a próxima
 * reconciliação e a escrita principal do livro continua válida.
 */
export async function syncBookIndex(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela recém-criada (ou recriada por troca de modelo): reconcilia os demais livros
    if (created) await reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** Garante que todos os livros de `livros` tenham vetor atualizado para o modelo atual. */
export async function reconcileBookIndex(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    if (rows.length === 0) {
      await ensureBookVectors(embedder);
      return { indexed: 0, removed: 0 };
    }
    const { created, ...result } = await syncIds(rows.map((row) => row.id), integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo atualiza os vetores dos livros dele. */
export async function syncAuthorBookIndex(
  authorId: number,
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration, embedder);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

/** Os `limit` livros mais próximos do vetor pela distância cosseno (<=>), do mais perto para o mais longe. */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const queryVector = toPgVector(vector);
  const rows = await sql`
    SELECT livro_id AS id, (embedding <=> ${queryVector}::vector)::float8 AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${queryVector}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];
  return rows.map((row) => ({ id: row.id, distance: Number(row.distance) }));
}
