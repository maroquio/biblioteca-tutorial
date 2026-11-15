import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no próprio Postgres, com pgvector. Uma linha por livro, com
 * o texto que o modelo leu e o vetor dele; o índice HNSW (distância cosseno) acha
 * os vizinhos mais próximos de uma consulta. Tudo aqui é derivado de `livros`: a
 * chave estrangeira com ON DELETE CASCADE leva o vetor junto quando o livro sai,
 * na mesma transação do DELETE, então não existem vetores órfãos.
 *
 * A dimensão da coluna vem do embedder (1024 no hash dos testes, 768 no Gemini),
 * por isso a tabela não nasce no prepareCatalog: quem a cria é o ensureBookVectors.
 * O comentário da tabela guarda o id do embedder que a criou.
 */
const TABLE = "livros_vetores";

export type IndexResult = { indexed: number };

/** O formato de texto do pgvector: "[0.9,0.1,0]". O ::vector converte o parâmetro. */
function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** O embedder que criou a tabela, ou null se ela ainda não existe. */
async function tableModel(): Promise<string | null> {
  const [row] = await sql`SELECT obj_description(to_regclass(${`public.${TABLE}`}), 'pg_class') AS model` as { model: string | null }[];
  return row?.model ?? null;
}

/**
 * Garante que a tabela existe para este embedder e diz se precisou criá-la.
 * Vetores de outro modelo não se comparam com os deste (nem têm a mesma
 * dimensão): trocar de modelo apaga a tabela e começa de novo.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  // caminho rápido, sem lock: quase sempre a tabela já está certa
  if (await tableModel() === embedder.id) return false;
  // DDL não aceita parâmetros: vector(${n}) viraria vector($1). A dimensão entra
  // no texto do comando, e por isso precisa ser um inteiro de verdade
  const dimensions = embedder.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1) throw new Error(`Dimensão inválida: ${dimensions}`);
  const model = embedder.id.replaceAll("'", "''");
  // o lock das escritas serializa duas criações simultâneas; DDL é rápido, nada de
  // embedding aqui dentro
  return inTransaction(async (tx) => {
    if (await tableModel() === embedder.id) return false;
    await tx.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await tx.unsafe(`
      CREATE TABLE ${TABLE} (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )
    `);
    await tx.unsafe(`CREATE INDEX ${TABLE}_embedding_idx ON ${TABLE} USING hnsw (embedding vector_cosine_ops)`);
    await tx.unsafe(`COMMENT ON TABLE ${TABLE} IS '${model}'`);
    return true;
  });
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

function isForeignKeyViolation(error: unknown): boolean {
  const e = error as { errno?: string; code?: string; message?: string };
  return e.errno === "23503" || e.code === "23503" || /foreign key/i.test(e.message ?? "");
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder): Promise<IndexResult & { created: boolean }> {
  const created = await ensureBookVectors(embedder);
  const result = { indexed: 0, created };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;

  // livro que não está mais em `livros` não tem o que indexar: o CASCADE já levou o vetor
  const rows = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;
  const stored = await sql`SELECT livro_id AS id, texto AS text FROM livros_vetores WHERE livro_id IN ${sql(rows.map((row) => row.id))}` as { id: number; text: string }[];
  const storedText = new Map(stored.map((row) => [row.id, row.text]));

  // só paga o embedding de quem não tem vetor ou cujo texto mudou. A dimensão não
  // precisa de conferência: o pgvector recusa alto ("expected 768 dimensions") e a
  // tabela de outro modelo já foi refeita pelo ensure
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (storedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    try {
      await sql`
        INSERT INTO livros_vetores (livro_id, texto, embedding)
        VALUES (${item.id}, ${item.text}, ${toPgvector(vectors[i]!)}::vector)
        ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
      `;
      result.indexed++;
    } catch (error) {
      // o livro foi excluído enquanto o embedding era calculado: nada a gravar
      if (!isForeignKeyViolation(error)) throw error;
    }
  }
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini o
 * livro fica sem vetor até a próxima reconciliação, e a escrita em `livros`, que
 * é o que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0 };
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/**
 * Compara os vetores com `livros`: indexa os livros sem vetor (o seed escreve
 * direto na tabela; o Gemini estava fora no cadastro) e os de texto desatualizado
 * (o autor foi renomeado com o Gemini fora). Órfãos não existem, graças ao CASCADE.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0 };
  try {
    const ids = (await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id);
    const { created, ...result } = await syncIds(ids, integration, embedder);
    return result;
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
 * O par ORDER BY <expressão> <=> vetor LIMIT n é o que o índice HNSW com
 * vector_cosine_ops sabe acelerar; <=> devolve 1 − cos(θ), a mesma distância
 * do DISTANCE_METRIC COSINE do Redis, então o limiar do embedder não muda.
 */
export async function nearestBooks(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = toPgvector(vector);
  const rows = await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as { id: number; distance: number | string }[];
  return rows.map((row) => ({ id: row.id, distance: Number(row.distance) }));
}
