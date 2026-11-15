import type { SQL, TransactionSQL } from "bun";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no próprio PostgreSQL, com a extensão pgvector. Cada livro
 * tem uma linha em livros_vetores com o texto indexado, o modelo que gerou o
 * vetor e o vetor; o índice HNSW acha os vizinhos mais próximos de uma consulta.
 * A linha é derivada de livros: some junto com o livro (ON DELETE CASCADE) e
 * pode ser refeita a qualquer momento pela reconciliação.
 */
export type IndexResult = { indexed: number };

type Db = SQL | TransactionSQL;

/** Livros por rodada na reconciliação: mantém o IN (...) longe do limite de parâmetros. */
const CHUNK = 500;

/** O limite do índice HNSW para o tipo vector. */
const MAX_DIMENSIONS = 2000;

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function toVectorText(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/**
 * A tabela serve para este embedder? A coluna precisa ter a dimensão dele, e
 * nenhuma linha pode ser de outro modelo: dois modelos com a mesma dimensão
 * produzem vetores que não se comparam.
 */
async function isCurrent(db: Db, embedder: Embedder): Promise<boolean> {
  const [column] = await db`
    SELECT format_type(atttypid, atttypmod) AS type
    FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
  ` as { type: string }[];
  if (column?.type !== `vector(${embedder.dimensions})`) return false;
  const [other] = await db`SELECT 1 AS found FROM livros_vetores WHERE modelo <> ${embedder.id} LIMIT 1`;
  return !other;
}

/**
 * Garante que a tabela e o índice existem para este embedder e diz se precisou
 * criá-los. Trocar de modelo apaga a tabela e começa de novo, como o
 * FT.DROPINDEX ... DD fazia no Redis.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  if (await isCurrent(sql, embedder)) return false;
  const dimensions = embedder.dimensions;
  // a dimensão entra no texto do DDL (não pode ser parâmetro): só passa se for mesmo um número
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw new Error(`Dimensão de embedding inválida: ${dimensions}`);
  }
  // DDL rápido, sem chamada externa: pode ficar na fila das escritas
  return await inTransaction(async (tx) => {
    // outra requisição pode ter criado a tabela enquanto esta esperava a vez
    if (await isCurrent(tx, embedder)) return false;
    await tx.unsafe(`DROP TABLE IF EXISTS livros_vetores`);
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        modelo TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )`);
    await tx.unsafe(`CREATE INDEX livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`);
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
  // remover não é mais tarefa daqui: o CASCADE apaga o vetor junto com o livro
  if (!embedder || unique.length === 0) return result;

  result.created = await ensureBookVectors(embedder);
  const books = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];
  if (books.length === 0) return result;
  const stored = new Map(
    (await sql`SELECT livro_id AS id, texto AS text FROM livros_vetores WHERE livro_id IN ${sql(unique)}` as { id: number; text: string }[])
      .map((row) => [row.id, row.text]),
  );

  // só paga o embedding quando o livro ainda não tem vetor ou quando o texto mudou
  const authorNames = new Map<number, string | undefined>();
  const pending: { id: number; text: string }[] = [];
  for (const book of books) {
    if (!authorNames.has(book.authorId)) authorNames.set(book.authorId, (await integration.author(sql, book.authorId))?.name);
    const text = indexText(book.title, authorNames.get(book.authorId));
    if (stored.get(book.id) !== text) pending.push({ id: book.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // o "upsert": cria a linha ou, se o livro já tem vetor, troca o texto e o vetor.
    // O SELECT ... FOR KEY SHARE cobre o livro excluído enquanto o embedding era
    // calculado: sem livro, nada é gravado, em vez de um erro de chave estrangeira
    await sql`
      INSERT INTO livros_vetores (livro_id, texto, modelo, embedding)
      SELECT id, ${item.text}, ${embedder.id}, ${toVectorText(vectors[i]!)}::vector
      FROM livros WHERE id = ${item.id} FOR KEY SHARE
      ON CONFLICT (livro_id) DO UPDATE
        SET texto = EXCLUDED.texto, modelo = EXCLUDED.modelo, embedding = EXCLUDED.embedding
    `;
  }
  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini
 * o livro fica sem vetor até a próxima reconciliação, e a escrita do livro, que
 * é o que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (primeira subida, modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/**
 * Compara a tabela de vetores com livros e indexa o que falta: livros sem vetor
 * (o seed escreve direto em livros; o Gemini estava fora) e vetores com o texto
 * desatualizado. Órfãos não existem: a chave estrangeira não deixa.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const ids = (await sql`SELECT id FROM livros ORDER BY id` as { id: number }[]).map((row) => row.id);
    let indexed = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      indexed += (await syncIds(ids.slice(i, i + CHUNK), integration, embedder)).indexed;
    }
    return { indexed };
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
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

export type KnnHit = { id: number; distance: number };

/**
 * Os `limit` livros mais próximos do vetor, do mais perto para o mais longe.
 * <=> é a distância cosseno (1 − cos θ), a mesma métrica do índice
 * (vector_cosine_ops); ORDER BY ... LIMIT é a forma do KNN que o HNSW acelera.
 */
export async function nearestBookVectors(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toVectorText(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
