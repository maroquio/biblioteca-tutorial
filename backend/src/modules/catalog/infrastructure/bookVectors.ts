
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type VectorSyncResult = {
  indexed: number;
};

/**
 * Prepara a tabela de vetores de acordo com o modelo de embedding utilizado.
 *
 * Retorna true quando a tabela é criada ou recriada.
 * Retorna false quando a tabela já está atualizada.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  const dimensions = embedder.dimensions;

  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida para o índice vetorial: ${dimensions}`);
  }

  const [metadata] = await sql`
    SELECT obj_description(
      to_regclass('public.livros_vetores'),
      'pg_class'
    ) AS model
  ` as { model: string | null }[];

  const expectedModel = `embedder:${embedder.id}`;

  if (metadata?.model === expectedModel) {
    return false;
  }

  await sql`DROP TABLE IF EXISTS livros_vetores`;

  await sql.unsafe(`
    CREATE TABLE livros_vetores (
      livro_id INTEGER PRIMARY KEY
        REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL
    )
  `);

  await sql`
    CREATE INDEX livros_vetores_embedding_hnsw_idx
    ON livros_vetores
    USING hnsw (embedding vector_cosine_ops)
  `;

  const escapedModel = expectedModel.replace(/'/g, "''");

  await sql.unsafe(`
    COMMENT ON TABLE livros_vetores IS '${escapedModel}'
  `);

  return true;
}

/** Texto utilizado pelo modelo para representar cada livro. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/**
 * Sincroniza os vetores dos livros informados.
 *
 * Se a tabela precisar ser recriada, todos os livros serão reindexados.
 * O embedding acontece fora de qualquer transação de cadastro.
 */
export async function syncBookVectors(
  ids: number[],
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<VectorSyncResult> {
  if (!embedder) return { indexed: 0 };

  try {
    const created = await ensureBookVectors(embedder);

    const unique = [...new Set(ids)];

    // Se a tabela foi recriada, todos os livros precisam ser indexados.
    const targetIds = created
      ? (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id)
      : unique;

    if (targetIds.length === 0) return { indexed: 0 };

    const rows = await sql`
      SELECT id, titulo AS title, autor_id AS "authorId"
      FROM livros
      WHERE id IN ${sql(targetIds)}
    ` as { id: number; title: string; authorId: number }[];

    const pending: { id: number; text: string }[] = [];

    const existing = await sql`
      SELECT livro_id AS id, texto
      FROM livros_vetores
      WHERE livro_id IN ${sql(rows.map((row) => row.id))}
    ` as { id: number; texto: string }[];

    const existingById = new Map(
      existing.map((item) => [item.id, item.texto]),
    );

    for (const row of rows) {
      const author = await integration.author(sql, row.authorId);
      const text = indexText(row.title, author?.name);

      // Só gera embedding quando o texto mudou ou ainda não existe.
      if (existingById.get(row.id) !== text) {
        pending.push({ id: row.id, text });
      }
    }

    if (pending.length === 0) return { indexed: 0 };

    const vectors = await embedder.embed(
      pending.map((item) => item.text),
      "document",
    );

    if (vectors.length !== pending.length) {
      throw new Error("Quantidade de embeddings retornada é inválida");
    }

    for (const [i, item] of pending.entries()) {
      const vector = vectors[i]!;

      if (vector.length !== embedder.dimensions) {
        throw new Error("Dimensão do embedding retornado é inválida");
      }

      const serializedVector = `[${Array.from(vector).join(",")}]`;

      await sql`
        INSERT INTO livros_vetores (livro_id, texto, embedding)
        VALUES (${item.id}, ${item.text}, ${serializedVector}::vector)
        ON CONFLICT (livro_id)
        DO UPDATE SET
          texto = EXCLUDED.texto,
          embedding = EXCLUDED.embedding
      `;
    }

    return { indexed: pending.length };
  } catch (error) {
    console.warn(
      "Indexação vetorial indisponível:",
      (error as Error).message,
    );

    return { indexed: 0 };
  }
}

/** Reconcilia todos os livros existentes no PostgreSQL. */
export async function reconcileBookVectors(
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<VectorSyncResult> {
  if (!embedder) return { indexed: 0 };

  const ids = (await sql`SELECT id FROM livros` as { id: number }[])
    .map((row) => row.id);

  return syncBookVectors(ids, integration, embedder);
}

/** Reindexa os livros de um autor quando seu nome é alterado. */
export async function syncAuthorBookVectors(
  authorId: number,
  integration: CatalogIntegration,
  embedder: Embedder | null = defaultEmbedder,
): Promise<void> {
  const rows = await sql`
    SELECT id FROM livros WHERE autor_id = ${authorId}
  ` as { id: number }[];

  await syncBookVectors(
    rows.map((row) => row.id),
    integration,
    embedder,
  );
}
