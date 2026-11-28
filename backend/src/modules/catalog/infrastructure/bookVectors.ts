import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogDb, CatalogIntegration } from "../domain/CatalogIntegration";

export type KnnHit = { id: number; distance: number };
type IndexResult = { indexed: number; removed: number };

function vectorText(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

async function currentModel(db: CatalogDb, embedder: Embedder): Promise<boolean> {
  const [model] = await db`
    SELECT 1 FROM acervo_modelo_vetorial
    WHERE modelo = ${embedder.id} AND dimensoes = ${embedder.dimensions}
      AND to_regclass('acervo_vetores') IS NOT NULL
      AND to_regclass('acervo_vetores_hnsw') IS NOT NULL
  `;
  return Boolean(model);
}

/** Uma troca de modelo substitui os vetores e os metadados no mesmo COMMIT. */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  const n = embedder.dimensions;
  if (!Number.isInteger(n) || n < 1 || n > 2000) throw new Error(`Dimensão inválida: ${n}`);
  if (await currentModel(sql, embedder)) return false;
  return inTransaction(async (tx) => {
    // Outra requisição pode ter preparado a tabela enquanto esperávamos o lock.
    if (await currentModel(tx, embedder)) return false;
    await tx`DROP TABLE IF EXISTS acervo_vetores`;
    await tx.unsafe(`CREATE TABLE acervo_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      embedding vector(${n}) NOT NULL
    )`);
    await tx`CREATE INDEX acervo_vetores_hnsw ON acervo_vetores USING hnsw (embedding vector_cosine_ops)`;
    await tx`
      INSERT INTO acervo_modelo_vetorial (unico, modelo, dimensoes) VALUES (true, ${embedder.id}, ${n})
      ON CONFLICT (unico) DO UPDATE SET modelo = EXCLUDED.modelo, dimensoes = EXCLUDED.dimensoes
    `;
    return true;
  });
}

function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/** Sem filtro de ids, a mesma comparação reconcilia todo o acervo. */
async function pendingBooks(db: CatalogDb, ids: number[] | null, integration: CatalogIntegration) {
  const rows = await db`
    SELECT l.id, l.titulo, l.autor_id, v.texto FROM livros l
    LEFT JOIN acervo_vetores v ON v.livro_id = l.id
    ${ids ? db`WHERE l.id IN ${db(ids)}` : db``}
  ` as { id: number; titulo: string; autor_id: number; texto: string | null }[];
  const pending = new Map<number, string>();
  for (const row of rows) {
    const author = await integration.author(db, row.autor_id);
    const text = indexText(row.titulo, author?.name);
    if (row.texto !== text) pending.set(row.id, text);
  }
  return pending;
}

async function syncIds(ids: number[] | null, integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult> {
  const result = { indexed: 0, removed: 0 };
  if (!embedder || ids?.length === 0) return result;
  try {
    const created = await ensureBookIndex(embedder);
    const pending = await pendingBooks(sql, created ? null : ids, integration);
    if (!pending.size) return result;

    const texts = [...pending.values()];
    const vectors = await embedder.embed(texts, "document");
    if (vectors.length !== texts.length) throw new Error("O embedder devolveu um lote incompleto");

    result.indexed = await inTransaction(async (tx) => {
      // Enquanto o Gemini respondia, o livro, o autor ou o modelo podem ter mudado.
      if (!await currentModel(tx, embedder)) return 0;
      const bookIds = [...pending.keys()];
      const current = await pendingBooks(tx, bookIds, integration);
      let saved = 0;
      for (const [i, id] of bookIds.entries()) {
        if (current.get(id) !== texts[i]) continue;
        await tx`
          INSERT INTO acervo_vetores (livro_id, texto, embedding)
          VALUES (${id}, ${texts[i]!}, ${vectorText(vectors[i]!)}::vector)
          ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
        `;
        saved++;
      }
      return saved;
    });
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
  return result;
}

export function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder) {
  return syncIds(ids, integration, embedder);
}

export function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder) {
  return syncIds(null, integration, embedder);
}

export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

export async function knnSearch(vector: Float32Array, limit: number, embedder: Embedder): Promise<KnnHit[]> {
  const query = vectorText(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM acervo_vetores
    WHERE EXISTS (SELECT 1 FROM acervo_modelo_vetorial WHERE modelo = ${embedder.id} AND dimensoes = ${embedder.dimensions})
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
