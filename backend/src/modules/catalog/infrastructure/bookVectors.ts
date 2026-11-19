import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no PostgreSQL, com a extensão pgvector. Uma linha por livro,
 * com o texto indexado, o id do modelo que gerou o vetor e o vetor em si. A chave
 * estrangeira com ON DELETE CASCADE apaga o vetor junto com o livro. Tudo aqui é
 * derivado de `livros` e dos autores: pode ser apagado e reconstruído.
 */
export type IndexResult = { indexed: number };
export type KnnHit = { id: number; distance: number };

/** CREATE EXTENSION não aceita parâmetros e é idempotente; o lock evita corrida entre processos. */
export async function ensureVectorExtension(): Promise<void> {
  await inTransaction(async (tx) => {
    await tx`CREATE EXTENSION IF NOT EXISTS vector`;
  });
}

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** A dimensão da coluna que existe hoje, ou null se a tabela ainda não existe. */
async function currentDimensions(db: typeof sql): Promise<number | null> {
  const [row] = await db`
    SELECT atttypmod AS dims FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
  ` as { dims: number }[];
  return row ? row.dims : null;
}

/**
 * Garante que a tabela existe para este embedder e diz se precisou (re)criá-la.
 * Vetores de outro modelo não se comparam com os deste: trocar de modelo, ou de
 * dimensão, apaga a tabela e começa de novo.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  const dimensions = embedder.dimensions;
  // 2000 é o limite do índice HNSW para vector; o número vai cru para o DDL, então precisa ser validado
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida: ${dimensions}`);
  }
  const upToDate = async (db: typeof sql) => {
    if (await currentDimensions(db) !== dimensions) return false;
    const [other] = await db`SELECT 1 AS found FROM livros_vetores WHERE modelo <> ${embedder.id} LIMIT 1`;
    return !other;
  };
  if (await upToDate(sql)) return false;

  return await inTransaction(async (tx) => {
    // outra requisição pode ter recriado a tabela enquanto esperávamos o lock
    if (await upToDate(tx as unknown as typeof sql)) return false;
    await tx`DROP TABLE IF EXISTS livros_vetores`;
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        modelo TEXT NOT NULL,
        texto TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )`);
    await tx`CREATE INDEX livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
    return true;
  });
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, created: false };
  const unique = [...new Set(ids)];
  // livro excluído: a chave estrangeira já levou o vetor junto, não há o que remover
  if (unique.length === 0 || !embedder) return result;
  const rows = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;

  result.created = await ensureBookVectors(embedder);
  const stored = await sql`SELECT livro_id AS id, texto FROM livros_vetores WHERE livro_id IN ${sql(rows.map((row) => row.id))}` as { id: number; texto: string }[];
  const storedText = new Map(stored.map((row) => [row.id, row.texto]));

  // só paga o embedding quando o texto mudou ou quando o livro ainda não tem vetor
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (storedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // o SELECT ... FROM livros pula o livro que foi excluído enquanto o Gemini respondia
    await sql`
      INSERT INTO livros_vetores (livro_id, modelo, texto, embedding)
      SELECT id, ${embedder.id}, ${item.text}, ${toPgvector(vectors[i]!)}::vector FROM livros WHERE id = ${item.id}
      ON CONFLICT (livro_id) DO UPDATE
        SET modelo = EXCLUDED.modelo, texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
    `;
  }
  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini o
 * livro fica sem vetor até a próxima reconciliação, e a escrita no Postgres, que
 * é o que importa, já aconteceu. O embedding fica fora da transação de propósito:
 * ela segura o lock de todas as escritas.
 */
export async function syncBookVectors(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookVectors(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Vetores dos livros indisponíveis:", (error as Error).message);
    return { indexed: 0 };
  }
}

/** Indexa o que falta e refaz o que ficou com texto desatualizado: a comparação de texto pula quem está em dia. */
export async function reconcileBookVectors(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const ids = (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id);
    const { created: _created, ...result } = await syncIds(ids, integration, embedder);
    return result;
  } catch (error) {
    console.warn("Vetores dos livros indisponíveis:", (error as Error).message);
    return { indexed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo reindexa os livros dele. */
export async function syncAuthorBookVectors(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookVectors(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Vetores dos livros indisponíveis:", (error as Error).message);
  }
}

/** Os `limit` livros mais próximos do vetor (distância cosseno), do mais perto para o mais longe. */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgvector(vector);
  const rows = await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number }[];
  return rows.map((row) => ({ id: row.id, distance: Number(row.distance) }));
}
