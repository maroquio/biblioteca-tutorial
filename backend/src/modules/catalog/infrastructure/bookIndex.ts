import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

// Lock exclusivo do armazenamento vetorial; não bloqueia as escritas da biblioteca.
const VECTOR_LOCK = 22002;

/** Cria o esquema para este modelo ou o refaz quando a identidade/dimensão muda. */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  const { dimensions } = embedder;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida: ${dimensions}`);
  }
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${VECTOR_LOCK})`;
    // Metadados separados permitem reconhecer o modelo mesmo com o catálogo vazio.
    await tx`CREATE TABLE IF NOT EXISTS acervo_modelo_vetorial (
      unico BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (unico),
      modelo TEXT NOT NULL,
      dimensoes INTEGER NOT NULL
    )`;
    const [model] = await tx`SELECT modelo, dimensoes FROM acervo_modelo_vetorial WHERE unico` as { modelo: string; dimensoes: number }[];
    const [column] = await tx`
      SELECT format_type(atttypid, atttypmod) AS tipo FROM pg_attribute
      WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
    ` as { tipo: string }[];
    if (model?.modelo === embedder.id && model.dimensoes === dimensions && column?.tipo === `vector(${dimensions})`) return false;

    await tx`DROP TABLE IF EXISTS livros_vetores`;
    // DDL não aceita parâmetro no tipo vector(N); dimensions foi validado acima.
    await tx.unsafe(`CREATE TABLE livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL
    )`);
    await tx`CREATE INDEX livros_vetores_hnsw_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
    await tx`
      INSERT INTO acervo_modelo_vetorial (unico, modelo, dimensoes)
      VALUES (TRUE, ${embedder.id}, ${dimensions})
      ON CONFLICT (unico) DO UPDATE SET modelo = EXCLUDED.modelo, dimensoes = EXCLUDED.dimensoes
    `;
    return true;
  });
}

function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/** O cast ::vector recebe este texto como parâmetro, nunca concatenado no SQL. */
function vectorText(vector: Float32Array, dimensions: number): string {
  if (vector.length !== dimensions || !vector.every(Number.isFinite)) {
    throw new Error("Vetor incompatível com o embedder");
  }
  return `[${Array.from(vector).join(",")}]`;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder): Promise<IndexResult> {
  const result = { indexed: 0, removed: 0 };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;
  const rows = await sql`
    SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "indexedText"
    FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id
    WHERE l.id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number; indexedText: string | null }[];
  const pending: { id: number; title: string; authorId: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (text !== row.indexedText) pending.push({ ...row, text });
  }
  if (pending.length === 0) return result;

  // A rede fica fora da transação; o cadastro do livro já teve COMMIT.
  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  if (vectors.length !== pending.length) throw new Error("Quantidade de vetores incompatível com os documentos");
  const encoded = vectors.map((vector) => vectorText(vector, embedder.dimensions));
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${VECTOR_LOCK})`;
    const [model] = await tx`SELECT modelo, dimensoes FROM acervo_modelo_vetorial WHERE unico` as { modelo: string; dimensoes: number }[];
    if (model?.modelo !== embedder.id || model.dimensoes !== embedder.dimensions) return;
    for (const [i, item] of pending.entries()) {
      const author = await integration.author(tx, item.authorId);
      if (indexText(item.title, author?.name) !== item.text) continue;
      // Livro excluído ou alterado enquanto o provedor respondia não recebe vetor antigo.
      const saved = await tx`
        INSERT INTO livros_vetores (livro_id, texto, embedding)
        SELECT id, ${item.text}, ${encoded[i]!}::vector FROM livros
        WHERE id = ${item.id} AND titulo = ${item.title} AND autor_id = ${item.authorId}
        ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
        RETURNING livro_id
      `;
      result.indexed += saved.length;
    }
  });
  return result;
}

/** Depois do COMMIT. Nunca lança: uma falha fica para a próxima reconciliação. */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    const created = await ensureBookIndex(embedder);
    // Esquema novo precisa também dos livros fora desta alteração.
    const targetIds = created ? (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id) : ids;
    return await syncIds(targetIds, integration, embedder);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** Reconcilia ausentes e desatualizados; órfãos são impedidos pela FK/CASCADE. */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0, removed: 0 };
  try {
    await ensureBookIndex(embedder);
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    return await syncIds(rows.map((row) => row.id), integration, embedder);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo reindexa seus livros. */
export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

/** KNN por distância cosseno, com expressão no ORDER BY para permitir o HNSW. */
export async function knnSearch(vector: Float32Array, limit: number, embedder: Embedder): Promise<KnnHit[]> {
  const query = vectorText(vector, embedder.dimensions);
  return await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${VECTOR_LOCK})`;
    const [model] = await tx`SELECT modelo, dimensoes FROM acervo_modelo_vetorial WHERE unico` as { modelo: string; dimensoes: number }[];
    if (model?.modelo !== embedder.id || model.dimensoes !== embedder.dimensions) {
      throw new Error("O modelo vetorial mudou durante a consulta; tente novamente");
    }
    return await tx`
      SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
      FROM livros_vetores
      ORDER BY embedding <=> ${query}::vector
      LIMIT ${limit}
    ` as KnnHit[];
  });
}
