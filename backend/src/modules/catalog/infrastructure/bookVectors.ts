import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no próprio Postgres, com a extensão pgvector. Cada livro
 * tem no máximo uma linha em `livros_vetores`, com o texto que foi vetorizado,
 * o embedder que o vetorizou e o vetor; o índice HNSW acha os vizinhos mais
 * próximos de uma consulta. Tudo aqui é derivado de `livros`: a tabela pode ser
 * apagada e reconstruída a qualquer momento.
 */
export type IndexResult = { indexed: number };

/** O limite do índice HNSW para o tipo vector. */
const MAX_DIMENSIONS = 2000;

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function toVectorText(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** O tipo da coluna de vetores ("vector(768)"), ou null se a tabela ainda não existe. */
async function currentVectorType(db: typeof sql = sql): Promise<string | null> {
  const [column] = await db`
    SELECT format_type(atttypid, atttypmod) AS type
    FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
  ` as { type: string }[];
  return column?.type ?? null;
}

/**
 * A tabela serve para este embedder? Precisa existir, ter a dimensão dele e não
 * guardar vetor de outro modelo: dois modelos com a mesma dimensão produzem
 * vetores que não se comparam, por isso cada linha lembra o id de quem a criou.
 */
async function servesEmbedder(embedder: Embedder, db: typeof sql = sql): Promise<boolean> {
  if (await currentVectorType(db) !== `vector(${embedder.dimensions})`) return false;
  const [other] = await db`SELECT 1 FROM livros_vetores WHERE modelo <> ${embedder.id} LIMIT 1`;
  return !other;
}

/**
 * Garante que a tabela e o índice existem para este embedder e diz se precisou
 * criá-los. A dimensão da coluna vem do embedder, e por isso a tabela não nasce
 * no prepareCatalog: trocar de modelo apaga a tabela e começa de novo.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  if (await servesEmbedder(embedder)) return false;
  const { dimensions } = embedder;
  // a dimensão faz parte do tipo, não é um valor: não pode ser parâmetro ($1).
  // Ela entra no texto do comando, e só depois de comprovar que é um número
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o índice de vetores: ${dimensions}`);
  }
  return await inTransaction(async (tx) => {
    // outra requisição pode ter criado a tabela enquanto esta esperava a vez
    if (await servesEmbedder(embedder, tx)) return false;
    await tx`DROP TABLE IF EXISTS livros_vetores`;
    // as duas tabelas são do Acervo: aqui a chave estrangeira é permitida, e o
    // CASCADE apaga o vetor na mesma transação que apaga o livro
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        modelo TEXT NOT NULL,
        texto TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )
    `);
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
  // remover não passa por aqui: o ON DELETE CASCADE já levou o vetor do livro excluído
  if (!embedder || unique.length === 0) return result;

  result.created = await ensureBookVectors(embedder);
  // uma consulta só traz os livros e o texto que cada um já tem vetorizado
  const rows = await sql`
    SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS stored
    FROM livros l
    LEFT JOIN livros_vetores v ON v.livro_id = l.id
    WHERE l.id IN ${sql(unique)}
  ` as { id: number; title: string; authorId: number; stored: string | null }[];

  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    // só paga o embedding quando o livro ainda não tem vetor ou quando o texto mudou
    if (row.stored !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    await sql`
      INSERT INTO livros_vetores (livro_id, modelo, texto, embedding)
      VALUES (${item.id}, ${embedder.id}, ${item.text}, ${toVectorText(vectors[i]!)}::vector)
      ON CONFLICT (livro_id) DO UPDATE
        SET modelo = EXCLUDED.modelo, texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
    `;
  }
  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini o
 * livro fica sem vetor até a próxima reconciliação, e a escrita em `livros`, que
 * é o que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (primeiro uso, modelo trocado): os outros livros também precisam entrar
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/**
 * Compara a tabela de vetores inteira com `livros`: vetoriza quem está sem vetor
 * (o seed, um cadastro feito com o Gemini fora do ar) e quem ficou com o texto
 * desatualizado. Órfãos não existem: a chave estrangeira não deixa.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    const { created, ...result } = await syncIds(rows.map((row) => row.id), integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/** O nome do autor faz parte do texto vetorizado: renomeá-lo atualiza os livros dele. */
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
 * `<=>` é a distância cosseno (1 − cos θ), a mesma métrica do índice; o par
 * ORDER BY expressão LIMIT é a forma do KNN que o HNSW sabe acelerar.
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
