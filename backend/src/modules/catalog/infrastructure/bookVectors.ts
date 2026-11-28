import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** Converte Float32Array para o formato textual aceito pelo pgvector: "[0.1,0.2,...]" */
export function comoTextoDoPgvector(vetor: Float32Array): string {
  return `[${Array.from(vetor).join(",")}]`;
}

/**
 * Garante que a tabela livros_vetores existe para este embedder e diz se precisou criá-la.
 * Se o modelo ou a dimensão mudarem, descarta a tabela anterior e recria,
 * disparando a reconciliação.
 */
export async function ensureBookVectorsTable(embedder: Embedder): Promise<boolean> {
  const { dimensions, id: modelId } = embedder;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida para pgvector: ${dimensions}`);
  }

  // Verifica se a tabela já existe
  const [tableExists] = await sql`
    SELECT to_regclass('public.livros_vetores') IS NOT NULL AS "exists"
  ` as { exists: boolean }[];

  if (tableExists?.exists) {
    // Verifica dimensão e modelo existente
    const [attr] = await sql`
      SELECT format_type(atttypid, atttypmod) AS tipo
      FROM pg_attribute
      WHERE attrelid = to_regclass('public.livros_vetores') AND attname = 'embedding'
    ` as { tipo: string }[];

    const expectedType = `vector(${dimensions})`;
    const [diffModel] = await sql`
      SELECT 1 FROM livros_vetores WHERE modelo <> ${modelId} LIMIT 1
    ` as { "?column?": number }[];

    if (attr?.tipo === expectedType && !diffModel) {
      return false;
    }

    // Modelo ou dimensão diferente: recria
    await sql`DROP TABLE livros_vetores`;
  }

  // Cria tabela e índice HNSW com distância cosseno
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      modelo TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL
    );
    CREATE INDEX IF NOT EXISTS livros_vetores_embedding_hnsw_idx
      ON livros_vetores USING hnsw (embedding vector_cosine_ops);
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

  const existingIds = new Set(rows.map((r) => r.id));
  const toDelete = unique.filter((id) => !existingIds.has(id));
  if (toDelete.length > 0) {
    const deleted = await sql`
      DELETE FROM livros_vetores WHERE livro_id IN ${sql(toDelete)}
    ` as unknown as { count?: number };
    result.removed = (deleted as any).count ?? toDelete.length;
  }

  if (!embedder || rows.length === 0) return result;

  result.created = await ensureBookVectorsTable(embedder);

  // Busca os registros já existentes para esses livros para checar texto e modelo
  const currentVectors = await sql`
    SELECT livro_id AS "livroId", texto, modelo
    FROM livros_vetores
    WHERE livro_id IN ${sql(rows.map((r) => r.id))}
  ` as { livroId: number; texto: string; modelo: string }[];

  const vectorMap = new Map(currentVectors.map((v) => [v.livroId, v]));

  // Busca os autores de uma só vez para evitar consultas individuais no loop
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const authors = await sql`SELECT id, nome AS name FROM autores WHERE id IN ${sql(authorIds)}` as { id: number; name: string }[];
  const authorMap = new Map(authors.map((a) => [a.id, a.name]));

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const authorName = authorMap.get(row.authorId) ?? (await integration.author(sql, row.authorId))?.name;
    const text = indexText(row.title, authorName);
    const curr = vectorMap.get(row.id);
    const same = curr && curr.texto === text && curr.modelo === embedder.id;
    if (!same) {
      pending.push({ id: row.id, text });
    }
  }

  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((p) => p.text), "document");

  // Re-verifica se os livros ainda existem antes de inserir (evita corrida/exclusão concorrente)
  const stillExisting = new Set(
    (await sql`SELECT id FROM livros WHERE id IN ${sql(pending.map((p) => p.id))}` as { id: number }[])
      .map((r) => r.id),
  );

  const entriesToInsert: { id: number; text: string; vector: string }[] = [];
  for (let i = 0; i < pending.length; i++) {
    const item = pending[i]!;
    if (stillExisting.has(item.id)) {
      entriesToInsert.push({
        id: item.id,
        text: item.text,
        vector: comoTextoDoPgvector(vectors[i]!),
      });
    }
  }

  if (entriesToInsert.length > 0) {
    // Insere em lote dentro de uma transação para ser instantâneo
    await sql.begin(async (tx) => {
      for (const entry of entriesToInsert) {
        await tx`
          INSERT INTO livros_vetores (livro_id, texto, modelo, embedding)
          VALUES (${entry.id}, ${entry.text}, ${embedder.id}, ${entry.vector}::vector)
          ON CONFLICT (livro_id) DO UPDATE
            SET texto = EXCLUDED.texto,
                modelo = EXCLUDED.modelo,
                embedding = EXCLUDED.embedding
        `;
      }
    });
  }

  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza o índice para estes livros, depois do COMMIT.
 * Nunca lança: sem embedder ou com falha do Gemini, a escrita no Postgres não é afetada.
 */
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

/**
 * Compara o catálogo com a tabela de vetores:
 * indexa livros que ainda não têm vetor ou cujo texto mudou.
 */
export async function reconcileBookIndex(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  try {
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    const ids = rows.map((r) => r.id);
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

/** Os `limit` livros mais próximos do vetor, do mais perto para o mais longe usando pgvector (<=>). */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const queryText = comoTextoDoPgvector(vector);
  const rows = await sql`
    SELECT livro_id AS id, embedding <=> ${queryText}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${queryText}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];

  return rows.map((r) => ({ id: r.id, distance: Number(r.distance) }));
}
