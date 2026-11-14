import type { SQL } from "bun";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no PostgreSQL, com a extensão pgvector. Cada livro tem uma
 * linha com o texto indexado e o vetor; o índice HNSW acha os vizinhos mais
 * próximos de uma consulta. Tudo aqui é derivado de `livros`: pode ser apagado e
 * reconstruído a qualquer momento, e a chave estrangeira com ON DELETE CASCADE
 * apaga o vetor junto com o livro, na mesma transação.
 */
const TABLE = "livros_vetores";
/** O limite do índice HNSW para o tipo `vector`. */
const MAX_DIMENSIONS = 2000;

export type IndexResult = { indexed: number };

/** O formato de texto do pgvector: "[0.9,0.1,0]". */
function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** O Postgres só aceita parâmetro onde vai um valor: no DDL o texto vai cru, então escapamos. */
function sqlLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

type TableInfo = { type: string; model: string | null };

/**
 * Como a tabela está agora: o tipo da coluna (`vector(768)`) e o embedder que a
 * criou, guardado no comentário da tabela. Só a dimensão não bastaria: dois
 * modelos de 768 dimensões produzem vetores que não se comparam.
 */
async function tableInfo(db: SQL): Promise<TableInfo | null> {
  const [row] = await db`
    SELECT format_type(a.atttypid, a.atttypmod) AS type, obj_description(a.attrelid, 'pg_class') AS model
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(${TABLE}) AND a.attname = 'embedding' AND NOT a.attisdropped
  ` as TableInfo[];
  return row ?? null;
}

/**
 * Garante que a tabela existe para este embedder e diz se precisou criá-la.
 * Vetores de outro modelo não se comparam com os deste: trocar de modelo (ou de
 * dimensão) apaga a tabela e começa de novo. Quem recebe `true` deve reconciliar,
 * porque a tabela nova está vazia.
 */
export async function ensureBookVectors(embedder: Embedder): Promise<boolean> {
  const expected = `vector(${embedder.dimensions})`;
  const upToDate = (info: TableInfo | null) => info?.type === expected && info.model === embedder.id;
  // caminho comum: uma consulta ao catálogo, sem lock
  if (upToDate(await tableInfo(sql))) return false;

  // `vector(${n})` dentro de sql`…` viraria `vector($1)`, que o Postgres recusa: a dimensão é
  // estrutura do comando, não valor. Por isso o DDL é montado como texto, depois de validar o número.
  if (!Number.isInteger(embedder.dimensions) || embedder.dimensions < 1 || embedder.dimensions > MAX_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o índice HNSW: ${embedder.dimensions}`);
  }
  return await inTransaction(async (tx) => {
    // sob o lock, confere de novo: outra requisição pode ter criado a tabela enquanto esperávamos
    if (upToDate(await tableInfo(tx))) return false;
    await tx.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await tx.unsafe(`
      CREATE TABLE ${TABLE} (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        embedding ${expected} NOT NULL
      )`);
    await tx.unsafe(`CREATE INDEX ${TABLE}_embedding_idx ON ${TABLE} USING hnsw (embedding vector_cosine_ops)`);
    await tx.unsafe(`COMMENT ON TABLE ${TABLE} IS ${sqlLiteral(embedder.id)}`);
    return true;
  });
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

/**
 * Grava o vetor de cada livro cujo texto mudou ou que ainda não tem vetor.
 * Livro que sumiu do Postgres não tem o que fazer aqui: o CASCADE já levou o vetor.
 */
async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0 || !embedder) return result;
  const rows = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];
  if (rows.length === 0) return result;

  result.created = await ensureBookVectors(embedder);
  // os textos já gravados de todos os livros, numa consulta só
  const stored = await sql`SELECT livro_id AS id, texto AS text FROM livros_vetores WHERE livro_id IN ${sql(rows.map((row) => row.id))}` as { id: number; text: string }[];
  const storedText = new Map(stored.map((row) => [row.id, row.text]));

  // só paga o embedding quando o texto mudou ou o livro ainda não tem vetor
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    if (storedText.get(row.id) !== text) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // o INSERT … SELECT … FROM livros ignora, sem erro de chave estrangeira, um livro
    // excluído enquanto o Gemini respondia
    const written = await sql`
      INSERT INTO livros_vetores (livro_id, texto, embedding)
      SELECT id, ${item.text}, ${toPgvector(vectors[i]!)}::vector FROM livros WHERE id = ${item.id}
      ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
      RETURNING livro_id
    ` as unknown[];
    result.indexed += written.length;
  }
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: sem Gemini o
 * livro fica sem vetor (ou com o antigo) até a próxima reconciliação, e a escrita
 * no Postgres, que é o que importa, já aconteceu. O embedding nunca roda dentro
 * do inTransaction: o lock das escritas esperaria a rede.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (modelo trocado): os outros livros também precisam entrar
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Vetores semânticos indisponíveis:", (error as Error).message);
    return { indexed: 0 };
  }
}

const RECONCILE_CHUNK = 500;

/** Compara os vetores com `livros`: indexa quem não tem vetor e refaz quem está com o texto desatualizado. */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const ids = (await sql`SELECT id FROM livros ORDER BY id` as { id: number }[]).map((row) => row.id);
    let indexed = 0;
    for (let i = 0; i < ids.length; i += RECONCILE_CHUNK) {
      // a comparação de texto pula quem já está em dia: só paga embedding o que mudou
      indexed += (await syncIds(ids.slice(i, i + RECONCILE_CHUNK), integration, embedder)).indexed;
    }
    return { indexed };
  } catch (error) {
    console.warn("Vetores semânticos indisponíveis:", (error as Error).message);
    return { indexed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo reindexa os livros dele. */
export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Vetores semânticos indisponíveis:", (error as Error).message);
  }
}

export type KnnHit = { id: number; distance: number };

/**
 * Os `limit` livros mais próximos do vetor, do mais perto para o mais longe.
 * `<=>` é a distância cosseno (1 − cos θ), a mesma do Redis, e o ORDER BY com a
 * expressão e o LIMIT é a forma que o índice HNSW reconhece.
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
