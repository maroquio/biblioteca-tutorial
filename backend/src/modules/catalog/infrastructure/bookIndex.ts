import type { RedisClient } from "bun";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { ready, redis, redisKey } from "../../../infrastructure/redis";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Índice vetorial dos livros no Redis Query Engine. Cada livro é um hash com o
 * texto indexado e o vetor (FLOAT32 binário); o índice HNSW acha os vizinhos
 * mais próximos de uma consulta. Tudo aqui é derivado do Postgres: pode ser
 * apagado e reconstruído a qualquer momento.
 */
const INDEX = redisKey("acervo", "livros");
const INDEX_MODEL = redisKey("acervo", "livros", "modelo");
const KEY_PREFIX = redisKey("acervo", "livro", "");

export type IndexResult = { indexed: number; removed: number };

export function bookIndexKey(id: number): string {
  return redisKey("acervo", "livro", String(id));
}

function isUnknownIndex(error: unknown): boolean {
  // Redis 8: "SEARCH_INDEX_NOT_FOUND Index not found"; versões anteriores: "Unknown index name"
  return /index not found|unknown index|no such index/i.test((error as Error).message);
}

/**
 * Garante que o índice existe para este embedder e diz se precisou criá-lo.
 * Vetores de outro modelo não se comparam com os deste: trocar de modelo apaga o
 * índice junto com os documentos (DD) e começa de novo.
 */
export async function ensureBookIndex(embedder: Embedder, client: RedisClient): Promise<boolean> {
  try {
    if (await client.get(INDEX_MODEL) === embedder.id) {
      await client.send("FT.INFO", [INDEX]);
      return false;
    }
    await client.send("FT.DROPINDEX", [INDEX, "DD"]);
  } catch (error) {
    if (!isUnknownIndex(error)) throw error;
  }
  try {
    await client.send("FT.CREATE", [
      INDEX, "ON", "HASH", "PREFIX", "1", KEY_PREFIX,
      "SCHEMA", "embedding", "VECTOR", "HNSW", "6",
      "TYPE", "FLOAT32", "DIM", String(embedder.dimensions), "DISTANCE_METRIC", "COSINE",
    ]);
  } catch (error) {
    // outra requisição criou o índice ao mesmo tempo
    if (/already exists/i.test((error as Error).message)) return false;
    throw error;
  }
  await client.set(INDEX_MODEL, embedder.id);
  return true;
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

async function syncIds(ids: number[], integration: CatalogIntegration, embedder: Embedder | null, client: RedisClient): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return result;
  await ready(client);
  const rows = await sql`SELECT id, titulo AS title, autor_id AS "authorId" FROM livros WHERE id IN ${sql(unique)}` as { id: number; title: string; authorId: number }[];

  // remover não precisa de embedder: o livro saiu do Postgres, sai do índice
  const existing = new Set(rows.map((row) => row.id));
  for (const id of unique) {
    if (!existing.has(id)) result.removed += await client.del(bookIndexKey(id));
  }
  if (!embedder || rows.length === 0) return result;

  result.created = await ensureBookIndex(embedder, client);
  const pending: { id: number; text: string }[] = [];
  for (const row of rows) {
    const text = indexText(row.title, (await integration.author(sql, row.authorId))?.name);
    // só paga o embedding quando o texto mudou ou quando o vetor gravado não tem o
    // tamanho deste modelo: o índice recusa esse vetor em silêncio, e ele ficaria para sempre
    const key = bookIndexKey(row.id);
    const sameText = await client.hget(key, "texto") === text;
    const rightSize = await client.send("HSTRLEN", [key, "embedding"]) === embedder.dimensions * 4;
    if (!sameText || !rightSize) pending.push({ id: row.id, text });
  }
  if (pending.length === 0) return result;

  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    const vector = vectors[i]!;
    const blob = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    // send aceita Buffer em tempo de execução; os tipos do Bun só declaram string
    await client.send("HSET", [bookIndexKey(item.id), "texto", item.text, "embedding", blob as unknown as string]);
  }
  result.indexed = pending.length;
  return result;
}

/**
 * Atualiza o índice para estes livros, depois do COMMIT. Nunca lança: sem Redis
 * ou sem Gemini o livro fica fora do índice até a próxima reconciliação, e a
 * escrita no Postgres, que é o que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder, client: RedisClient | null = redis): Promise<IndexResult> {
  if (!client) return { indexed: 0, removed: 0 };
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder, client);
    // índice novo (Redis reiniciado, modelo trocado): os outros livros também precisam entrar
    if (created) void reconcileBookIndex(integration, embedder, client);
    return result;
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** Compara o índice inteiro com o Postgres: indexa o que falta e remove o que sobrou. */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder, client: RedisClient | null = redis): Promise<IndexResult> {
  if (!client) return { indexed: 0, removed: 0 };
  try {
    await ready(client);
    const ids = new Set((await sql`SELECT id FROM livros` as { id: number }[]).map((row) => row.id));
    let cursor = "0";
    do {
      const [next, keys] = await client.scan(cursor, "MATCH", `${KEY_PREFIX}*`, "COUNT", 500);
      cursor = next;
      for (const key of keys) ids.add(Number(key.slice(KEY_PREFIX.length)));
    } while (cursor !== "0");
    const { created, ...result } = await syncIds([...ids], integration, embedder, client);
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

export type KnnHit = { id: number; distance: number };

/**
 * O Bun conversa em RESP3, e nele o FT.SEARCH responde um mapa
 * ({ results: [{ id, extra_attributes }] }). Em RESP2 a mesma resposta é uma
 * lista plana: [total, chave, [campo, valor], chave, [campo, valor], ...].
 */
export function parseKnnReply(reply: unknown, keyPrefix: string): KnnHit[] {
  const toHit = (key: string, distance: string) => ({ id: Number(key.slice(keyPrefix.length)), distance: Number(distance) });
  if (Array.isArray(reply)) {
    const hits: KnnHit[] = [];
    for (let i = 1; i < reply.length; i += 2) {
      const fields = reply[i + 1] as string[];
      hits.push(toHit(reply[i] as string, fields[fields.indexOf("distancia") + 1]!));
    }
    return hits;
  }
  const { results } = reply as { results: { id: string; extra_attributes: { distancia: string } }[] };
  return results.map((result) => toHit(result.id, result.extra_attributes.distancia));
}

/** Os `limit` livros mais próximos do vetor, do mais perto para o mais longe. */
export async function knnSearch(vector: Float32Array, limit: number, client: RedisClient): Promise<KnnHit[]> {
  const blob = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
  const reply = await client.send("FT.SEARCH", [
    INDEX, `*=>[KNN ${limit} @embedding $vetor AS distancia]`,
    "PARAMS", "2", "vetor", blob as unknown as string,
    "SORTBY", "distancia", "RETURN", "1", "distancia",
    "LIMIT", "0", String(limit), "DIALECT", "2",
  ]);
  return parseKnnReply(reply, KEY_PREFIX);
}
