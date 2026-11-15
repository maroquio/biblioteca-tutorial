import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogDb, CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no próprio Postgres, com o pgvector. Cada livro tem uma
 * linha em `livros_vetores` com o texto indexado e o vetor; o índice HNSW acha
 * os vizinhos mais próximos de uma consulta. Tudo aqui é derivado de `livros`:
 * a chave estrangeira com CASCADE apaga o vetor junto com o livro, e a tabela
 * pode ser refeita a qualquer momento.
 */
export type IndexResult = { indexed: number };

/** O comentário da tabela guarda o id do embedder que a criou; null se ela não existe. */
async function tableModel(db: CatalogDb): Promise<string | null> {
  const [row] = await db`SELECT obj_description(to_regclass('livros_vetores'), 'pg_class') AS model` as { model: string | null }[];
  return row!.model;
}

/**
 * DDL não aceita parâmetros (vector($1) é erro de sintaxe): o que entra cru no
 * texto do comando é validado antes. 2000 é o limite do HNSW para o tipo vector.
 */
function checkDdlInput({ id, dimensions }: Embedder): void {
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error(`Dimensão inválida para o índice HNSW: ${dimensions}`);
  }
  if (!/^[\w.-]+$/.test(id)) throw new Error(`Id de embedder inválido: ${id}`);
}

/**
 * Garante a tabela para este embedder e diz se precisou criá-la. Vetores de outro
 * modelo não se comparam com os deste: trocar de modelo apaga a tabela e cria
 * outra, com a dimensão nova.
 */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  if (await tableModel(sql) === embedder.id) return false;
  checkDdlInput(embedder);
  // o lock das escritas impede duas requisições de recriarem a tabela ao mesmo tempo
  return inTransaction(async (tx) => {
    if (await tableModel(tx) === embedder.id) return false;
    await tx`DROP TABLE IF EXISTS livros_vetores`;
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        embedding vector(${embedder.dimensions}) NOT NULL
      )
    `);
    await tx`CREATE INDEX livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
    await tx.unsafe(`COMMENT ON TABLE livros_vetores IS '${embedder.id}'`);
    return true;
  });
}

/** Um livro e o texto que o vetor gravado representa (null: ainda sem vetor). */
type IndexRow = { id: number; title: string; authorId: number; indexedText: string | null };

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/** O formato de texto do pgvector, "[0.9,0.1,0]", que o ::vector converte. */
function toVectorText(vector: Float32Array): string {
  return `[${vector.join(",")}]`;
}

async function indexRows(rows: IndexRow[], integration: CatalogIntegration, embedder: Embedder): Promise<number> {
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    // só paga o embedding quando o texto mudou ou o livro ainda não tem vetor
    if (row.indexedText !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return 0;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // INSERT … SELECT: se o livro foi excluído enquanto o embedder trabalhava, não grava nada
    await sql`
      INSERT INTO livros_vetores (livro_id, texto, embedding)
      SELECT id, ${item.text}, ${toVectorText(vectors[i]!)}::vector FROM livros WHERE id = ${item.id}
      ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
    `;
  }
  return pending.length;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini
 * o livro fica sem vetor até a próxima reconciliação, e a escrita do livro, que
 * é o que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  const unique = [...new Set(ids)];
  if (!embedder || unique.length === 0) return { indexed: 0 };
  try {
    const created = await ensureBookIndex(embedder);
    const rows = await sql`
      SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "indexedText"
      FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id
      WHERE l.id IN ${sql(unique)}
    ` as IndexRow[];
    const indexed = await indexRows(rows, integration, embedder);
    // tabela nova (modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookIndex(integration, embedder);
    return { indexed };
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/**
 * Indexa os livros que ainda não têm vetor (o seed escreve direto em `livros`)
 * e os de texto desatualizado. Órfãos não existem: a chave estrangeira não deixa.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0 };
  try {
    await ensureBookIndex(embedder);
    const rows = await sql`
      SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "indexedText"
      FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id
    ` as IndexRow[];
    return { indexed: await indexRows(rows, integration, embedder) };
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
 * Os `limit` livros mais próximos do vetor, do mais perto para o mais longe. O
 * ORDER BY usa a mesma distância do índice (<=> com vector_cosine_ops): é esse
 * par ORDER BY … LIMIT que o HNSW sabe acelerar.
 */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toVectorText(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
