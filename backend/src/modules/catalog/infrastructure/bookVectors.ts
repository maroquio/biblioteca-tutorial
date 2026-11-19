import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Índice vetorial dos livros no pgvector. Uma linha por livro, com o texto
 * indexado e o vetor. Tudo aqui é derivado de `livros`: pode ser apagado e
 * reconstruído a qualquer momento.
 */
const TABLE = "livros_vetores";
/** O limite do índice HNSW para o tipo `vector`. */
const MAX_HNSW_DIMENSIONS = 2000;
/** Lock próprio do DDL. O 22001 é o das escritas (transaction.ts) e não deve ser reaproveitado. */
const DDL_LOCK = 22002;

/**
 * Garante que a tabela e o índice existem para este embedder e diz se precisou
 * (re)criá-los. Vetores de outro modelo não se comparam com os deste: trocar de
 * modelo ou de dimensão apaga a tabela e começa de novo.
 */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  const dimensions = embedder.dimensions;
  // o número vai cru para o DDL (sql.unsafe): só entra depois de validado
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_HNSW_DIMENSIONS) {
    throw new Error(`Dimensão inválida: ${dimensions}`);
  }

  return await sql.begin(async (tx) => {
    // duas requisições chegando juntas não recriam a tabela uma por cima da outra
    await tx`SELECT pg_advisory_xact_lock(${DDL_LOCK})`;

    const [column] = await tx`
      SELECT format_type(atttypid, atttypmod) AS type
      FROM pg_attribute
      WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
    ` as { type: string }[];

    if (column) {
      const [otherModel] = await tx`
        SELECT 1 AS found FROM livros_vetores WHERE modelo <> ${embedder.id} LIMIT 1
      ` as { found: number }[];
      if (column.type === `vector(${dimensions})` && !otherModel) return false;
    }

    await tx.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await tx.unsafe(`
      CREATE TABLE ${TABLE} (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        modelo TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )
    `);
    await tx.unsafe(`
      CREATE INDEX ${TABLE}_embedding_idx ON ${TABLE} USING hnsw (embedding vector_cosine_ops)
    `);
    return true;
  }) as boolean;
}

export type IndexResult = { indexed: number; removed: number };

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/**
 * Fila em processo: ensure, sync e reconcile nunca rodam ao mesmo tempo. Sem ela,
 * uma reconciliação em segundo plano com outro embedder poderia recriar a tabela
 * no meio de uma escrita. Um pedido que falha não trava os seguintes.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  // livro excluído: a chave estrangeira com CASCADE já levou o vetor junto (removed fica em 0)
  if (!embedder || unique.length === 0) return result;
  const rows = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;

  result.created = await ensureBookIndex(embedder);
  const stored = await sql`SELECT livro_id AS id, texto AS text FROM livros_vetores WHERE livro_id IN ${sql(rows.map((row) => row.id))}` as { id: number; text: string }[];
  const storedText = new Map(stored.map((row) => [row.id, row.text]));

  // só paga o embedding de quem não tem vetor ou cujo texto mudou
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (storedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // INSERT … SELECT … FROM livros: se o livro foi excluído durante o embedding, nada é gravado
    // (um INSERT direto violaria a chave estrangeira e abortaria o resto do lote)
    const saved = await sql`
      INSERT INTO livros_vetores (livro_id, texto, modelo, embedding)
      SELECT id, ${item.text}::text, ${embedder.id}::text, ${toPgvector(vectors[i]!)}::vector
      FROM livros WHERE id = ${item.id}
      ON CONFLICT (livro_id) DO UPDATE
        SET texto = EXCLUDED.texto, modelo = EXCLUDED.modelo, embedding = EXCLUDED.embedding
      RETURNING livro_id
    ` as { livro_id: number }[];
    result.indexed += saved.length;
  }
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini o
 * livro fica sem vetor até a próxima reconciliação, e a escrita no Postgres, que
 * é o que importa, já aconteceu.
 */
export function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  return serialized(async () => {
    try {
      const { created, ...result } = await syncIds(ids, integration, embedder);
      // tabela nova (modelo trocado): os outros livros também precisam de vetor
      if (created) void reconcileBookIndex(integration, embedder);
      return result;
    } catch (error) {
      console.warn("Índice semântico indisponível:", (error as Error).message);
      return { indexed: 0, removed: 0 };
    }
  });
}

const RECONCILE_CHUNK = 500;

/** Indexa o que falta: livros sem vetor (o seed escreve direto em `livros`) ou com texto desatualizado. */
export function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  return serialized(async () => {
    const total = { indexed: 0, removed: 0 };
    try {
      const ids = (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id);
      // em lotes: o IN do Postgres tem um limite de parâmetros
      for (let i = 0; i < ids.length; i += RECONCILE_CHUNK) {
        total.indexed += (await syncIds(ids.slice(i, i + RECONCILE_CHUNK), integration, embedder)).indexed;
      }
    } catch (error) {
      console.warn("Índice semântico indisponível:", (error as Error).message);
    }
    return total;
  });
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

export type KnnHit = { id: number; distance: number };

/** Os `limit` livros mais próximos do vetor, do mais perto para o mais longe. */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgvector(vector);
  // a expressão no ORDER BY, com <=> e vector_cosine_ops, é o que o índice HNSW reconhece
  const rows = await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number | string }[];
  return rows.map((row) => ({ id: row.id, distance: Number(row.distance) }));
}