import type { TransactionSQL } from "bun";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no próprio Postgres, com o pgvector. Uma linha por livro,
 * com o texto indexado e o vetor; o índice HNSW (distância cosseno) acha os
 * vizinhos mais próximos de uma consulta. A chave estrangeira com CASCADE apaga o
 * vetor no mesmo DELETE do livro, então não existem órfãos.
 *
 * A tabela não nasce no prepareCatalog: a dimensão da coluna vem do embedder,
 * que só é conhecido aqui (e pode ser null). O id do embedder que criou a tabela
 * fica no comentário dela: vetores de outro modelo não se comparam com os deste.
 */
export const BOOK_VECTORS_TABLE = "livros_vetores";

/** O limite do índice HNSW para o tipo vector. */
const MAX_HNSW_DIMENSIONS = 2000;

export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** Literal SQL entre aspas simples, para o COMMENT, que não aceita parâmetro. */
function quoteLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

async function createTable(tx: TransactionSQL, embedder: Embedder): Promise<void> {
  const n = embedder.dimensions;
  // a dimensão é estrutura do comando, não valor: vai no texto, por isso a validação
  if (!Number.isInteger(n) || n < 1 || n > MAX_HNSW_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o índice HNSW: ${n}`);
  }
  await tx.unsafe(`
    CREATE TABLE ${BOOK_VECTORS_TABLE} (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      embedding vector(${n}) NOT NULL
    )`);
  await tx.unsafe(`CREATE INDEX ${BOOK_VECTORS_TABLE}_embedding_idx ON ${BOOK_VECTORS_TABLE} USING hnsw (embedding vector_cosine_ops)`);
  await tx.unsafe(`COMMENT ON TABLE ${BOOK_VECTORS_TABLE} IS ${quoteLiteral(embedder.id)}`);
}

/**
 * Garante que a tabela existe para este embedder e diz se precisou criá-la.
 * Trocar de modelo apaga a tabela e começa de novo, com a dimensão nova. O lock
 * das escritas evita que duas chamadas simultâneas criem a tabela ao mesmo tempo.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  return inTransaction(async (tx) => {
    const [row] = await tx`SELECT obj_description(to_regclass(${BOOK_VECTORS_TABLE}), 'pg_class') AS model` as { model: string | null }[];
    if (row!.model === embedder.id) return false;
    await tx.unsafe(`DROP TABLE IF EXISTS ${BOOK_VECTORS_TABLE}`);
    await createTable(tx, embedder);
    return true;
  });
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  // remover não precisa de nada: o CASCADE apagou o vetor junto com o livro
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  if (!embedder || unique.length === 0) return result;

  result.created = await ensureBookVectors(embedder);
  const rows = await sql`
    SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "storedText"
    FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id
    WHERE l.id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number; storedText: string | null }[];

  // só paga o embedding quando o texto mudou (ou o livro ainda não tem vetor)
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (row.storedText !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // o WHERE EXISTS pula o livro excluído enquanto o embedding era calculado
    await sql`
      INSERT INTO livros_vetores (livro_id, texto, embedding)
      SELECT ${item.id}, ${item.text}, ${toPgvector(vectors[i]!)}::vector
      WHERE EXISTS (SELECT 1 FROM livros WHERE id = ${item.id})
      ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
    `;
  }
  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT (nunca dentro do
 * inTransaction: o Gemini seguraria o lock de todas as escritas). Nunca lança:
 * sem Gemini o livro fica sem vetor até a próxima reconciliação, e a escrita no
 * Postgres, que é o que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/**
 * Dá vetor aos livros que não têm (o seed escreve direto em livros; o Gemini
 * estava fora do ar) e refaz os de texto desatualizado. A comparação de texto
 * pula quem já está em dia.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const ids = (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id);
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

/**
 * Os `limit` livros mais próximos do vetor, do mais perto para o mais longe.
 * A expressão do ORDER BY usa o mesmo operador da classe do índice (<=> com
 * vector_cosine_ops): é assim que o HNSW reconhece a consulta.
 */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgvector(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
