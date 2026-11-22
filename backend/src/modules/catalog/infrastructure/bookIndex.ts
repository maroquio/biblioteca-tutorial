import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

type BookToIndex = { id: number; title: string; authorId: number };
type StoredText = { livroId: number; text: string };

/** O texto representado pelo vetor inclui o autor, para que renomeá-lo atualize a busca. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

function vectorText(vector: Float32Array, dimensions: number): string {
  if (vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw new Error("Vetor inválido para o modelo selecionado");
  }
  return `[${Array.from(vector).join(",")}]`;
}

/** Cria a tabela e o índice HNSW; troca ambos quando o modelo ou a dimensão mudar. */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  const dimensions = embedder.dimensions;
  // O número faz parte do DDL, por isso é validado antes de entrar no SQL.
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida: ${dimensions}`);
  }

  return sql.begin(async (tx) => {
    // Duas requisições não podem recriar o índice simultaneamente.
    await tx`SELECT pg_advisory_xact_lock(22002)`;
    const [state] = await tx`
      SELECT modelo, dimensoes,
             to_regclass('public.livros_vetores') IS NOT NULL AS "tableExists"
      FROM acervo_indice_modelo WHERE id = 1
    ` as { modelo: string; dimensoes: number; tableExists: boolean }[];

    if (state?.modelo === embedder.id &&
        state.dimensoes === dimensions && state.tableExists) return false;

    await tx`DROP TABLE IF EXISTS livros_vetores`;
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        vetor vector(${dimensions}) NOT NULL
      )
    `);
    await tx`
      CREATE INDEX livros_vetores_hnsw_idx
      ON livros_vetores USING hnsw (vetor vector_cosine_ops)
    `;
    await tx`
      INSERT INTO acervo_indice_modelo (id, modelo, dimensoes)
      VALUES (1, ${embedder.id}, ${dimensions})
      ON CONFLICT (id) DO UPDATE
      SET modelo = EXCLUDED.modelo, dimensoes = EXCLUDED.dimensoes
    `;
    return true;
  });
}

async function syncIds(
  ids: number[], integration: CatalogIntegration, embedder: Embedder,
): Promise<IndexResult & { created: boolean }> {
  const created = await ensureBookIndex(embedder);
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { indexed: 0, removed: 0, created };

  const rows = await sql`
    SELECT id, titulo AS title, autor_id AS "authorId"
    FROM livros WHERE id IN ${sql(unique)}
  ` as BookToIndex[];
  if (rows.length === 0) return { indexed: 0, removed: 0, created };

  const saved = await sql`
    SELECT livro_id AS "livroId", texto AS text
    FROM livros_vetores WHERE livro_id IN ${sql(unique)}
  ` as StoredText[];
  const savedText = new Map(saved.map((item) => [item.livroId, item.text]));
  const pending: { id: number; text: string }[] = [];

  for (const row of rows) {
    const author = await integration.author(sql, row.authorId);
    const text = indexText(row.title, author?.name);
    if (savedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return { indexed: 0, removed: 0, created };

  // A chamada externa ao embedder ocorre fora de qualquer transação de escrita.
  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  if (vectors.length !== pending.length) throw new Error("Embedder retornou quantidade incorreta de vetores");

  let indexed = 0;
  for (const [i, item] of pending.entries()) {
    const encoded = vectorText(vectors[i]!, embedder.dimensions);
    // Se o livro foi excluído enquanto o vetor era calculado, não o recriamos.
    const written = await sql`
      INSERT INTO livros_vetores (livro_id, texto, vetor)
      SELECT id, ${item.text}, ${encoded}::vector FROM livros WHERE id = ${item.id}
      ON CONFLICT (livro_id) DO UPDATE
      SET texto = EXCLUDED.texto, vetor = EXCLUDED.vetor
      RETURNING livro_id
    `;
    indexed += written.length;
  }
  return { indexed, removed: 0, created };
}

/** Atualiza após o COMMIT. Falha do embedder nunca desfaz a escrita do livro. */
export async function syncBookIndex(
  ids: number[], integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
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

/** Inclui livros do seed, textos desatualizados e vetores de modelos trocados. */
export async function reconcileBookIndex(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const ids = await sql`SELECT id FROM livros` as { id: number }[];
    const { created: _created, ...result } = await syncIds(
      ids.map((row) => row.id), integration, embedder,
    );
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** Renomear um autor altera o texto semântico dos livros dele. */
export async function syncAuthorBookIndex(
  authorId: number, integration: CatalogIntegration,
): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

/** O operador cosseno, ORDER BY e LIMIT permitem usar o HNSW no PostgreSQL. */
export async function knnSearch(
  vector: Float32Array, limit: number, dimensions: number,
): Promise<KnnHit[]> {
  const encoded = vectorText(vector, dimensions);
  const rows = await sql`
    SELECT livro_id AS id, vetor <=> ${encoded}::vector AS distance
    FROM livros_vetores
    ORDER BY vetor <=> ${encoded}::vector
    LIMIT ${limit}
  ` as KnnHit[];
  return rows.map((row) => ({ id: Number(row.id), distance: Number(row.distance) }));
}
