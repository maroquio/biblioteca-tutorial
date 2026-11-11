import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogDb, CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Os vetores da busca semântica (UC24), no próprio Postgres, com o pgvector. A
 * tabela livros_vetores guarda, para cada livro, o texto indexado e o vetor dele;
 * o índice HNSW (distância cosseno) acha os vizinhos mais próximos de uma
 * consulta. Tudo aqui é derivado de livros e pode ser refeito a qualquer momento.
 *
 * A chave estrangeira com ON DELETE CASCADE apaga o vetor no mesmo DELETE do
 * livro, na mesma transação: não existem órfãos. As duas tabelas são do Acervo,
 * então a chave estrangeira é permitida (a regra do schema.ts vale entre módulos).
 */

export type IndexResult = { indexed: number };
export type KnnHit = { id: number; distance: number };

/** O limite do índice HNSW do pgvector para o tipo vector. */
const MAX_DIMENSIONS = 2000;

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function vectorText(vector: Float32Array): string {
  return `[${vector.join(",")}]`;
}

/** O id do embedder que criou a tabela fica no comentário dela; null se a tabela não existe. */
async function tableModel(db: CatalogDb): Promise<string | null> {
  const [row] = await db`SELECT obj_description(to_regclass('livros_vetores'), 'pg_class') AS model` as { model: string | null }[];
  return row?.model ?? null;
}

/**
 * Garante que a tabela existe para este embedder e diz se precisou criá-la.
 * Vetores de outro modelo não se comparam com os deste, e os de outra dimensão nem
 * cabem na coluna: trocar de modelo apaga a tabela e começa de novo, vazia.
 */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  const { id, dimensions } = embedder;
  if (await tableModel(sql) === id) return false;
  // a dimensão vai crua para o SQL (veja abaixo): só passa se for mesmo um número aceitável
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o índice HNSW: ${dimensions}`);
  }
  // DDL raro, curto e sem rede: pode entrar na fila de escritas da biblioteca
  return await inTransaction(async (tx) => {
    // outra chamada pode ter criado a tabela enquanto esta esperava o lock
    if (await tableModel(tx) === id) return false;
    await tx`DROP TABLE IF EXISTS livros_vetores`;
    // vector(N) faz parte da estrutura do comando, não é um valor: não pode virar $1
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        embedding vector(${dimensions}) NOT NULL
      )`);
    await tx`CREATE INDEX livros_vetores_embedding_idx ON livros_vetores USING hnsw (embedding vector_cosine_ops)`;
    // o COMMENT também não aceita parâmetro: o id vai como literal, com as aspas dobradas
    await tx.unsafe(`COMMENT ON TABLE livros_vetores IS '${id.replaceAll("'", "''")}'`);
    return true;
  });
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;
  // um livro excluído não volta aqui, e o vetor dele já saiu junto (ON DELETE CASCADE)
  const rows = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;

  result.created = await ensureBookIndex(embedder);
  // os textos guardados, numa consulta só: o vetor só é refeito quando o texto mudou
  const stored = await sql`SELECT livro_id AS id, texto AS text FROM livros_vetores WHERE livro_id IN ${sql(rows.map((row) => row.id))}` as { id: number; text: string }[];
  const storedText = new Map(stored.map((row) => [row.id, row.text]));
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    // a dimensão não precisa de conferência: a tabela é deste embedder, e o pgvector
    // recusa alto um vetor de outro tamanho ("expected 768 dimensions, not 1024")
    if (storedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // upsert: cria a linha do livro novo ou troca o texto e o vetor do que mudou. O
    // SELECT só grava se o livro ainda existe: excluído durante o embedding, a chave
    // estrangeira recusaria a linha e o erro derrubaria o resto do lote
    const saved = await sql`
      INSERT INTO livros_vetores (livro_id, texto, embedding)
      SELECT id, ${item.text}::text, ${vectorText(vectors[i]!)}::vector FROM livros WHERE id = ${item.id}
      ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
      RETURNING livro_id
    `;
    result.indexed += saved.length;
  }
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini o
 * livro fica sem vetor até a próxima reconciliação, e a escrita no Postgres, que é
 * o que importa, já aconteceu. Chamar o Gemini dentro do inTransaction seguraria o
 * lock de todas as escritas da biblioteca, e uma falha dele desfaria o cadastro.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0 };
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (primeira vez, modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Vetores dos livros indisponíveis:", (error as Error).message);
    return { indexed: 0 };
  }
}

/**
 * Dá vetor a quem não tem (o seed escreve direto em livros; o Gemini estava fora do
 * ar no cadastro) e refaz os de texto desatualizado (o autor foi renomeado com o
 * Gemini fora). Quem já está em dia é pulado pela comparação de texto, sem custar
 * embedding. Órfãos não existem: a chave estrangeira não deixa.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  if (!embedder) return { indexed: 0 };
  try {
    const rows = await sql`SELECT id FROM livros` as { id: number }[];
    const { indexed } = await syncIds(rows.map((row) => row.id), integration, embedder);
    return { indexed };
  } catch (error) {
    console.warn("Vetores dos livros indisponíveis:", (error as Error).message);
    return { indexed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo reindexa os livros dele. */
export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Vetores dos livros indisponíveis:", (error as Error).message);
  }
}

/**
 * Os `limit` livros mais próximos do vetor, do mais perto para o mais longe. O
 * ORDER BY usa a expressão do índice (<=> combina com vector_cosine_ops): é ela que
 * o HNSW sabe acelerar. <=> é 1 − cos(θ), a mesma distância que o Redis devolvia,
 * então o maxDistance calibrado na aula continua valendo.
 */
export async function knnSearch(vector: Float32Array, limit: number): Promise<KnnHit[]> {
  const query = vectorText(vector);
  return await sql`
    SELECT livro_id AS id, embedding <=> ${query}::vector AS distance
    FROM livros_vetores
    ORDER BY embedding <=> ${query}::vector
    LIMIT ${limit}
  ` as KnnHit[];
}
