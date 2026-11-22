import type { RedisClient } from "bun";
import { embedder as defaultEmbedder } from "../../../../infrastructure/embedder";
import { sql } from "../../../../infrastructure/postgres";
import { ready, redis } from "../../../../infrastructure/redis";
import { civilDate } from "../../../../shared/dates";
import type { Embedder } from "../../../../shared/Embedder";
import { InvalidInput, ServiceUnavailable } from "../../../../shared/errors";
import type { BookView } from "../../domain/Book";
import type { CatalogIntegration } from "../../domain/CatalogIntegration";
import { ensureBookIndex, knnSearch, reconcileBookIndex, type KnnHit } from "../../infrastructure/bookIndex";
import { toBookView, type BookRow } from "../../infrastructure/books";

const MAX_LENGTH = 200;

async function nearestBooks(q: string, integration: CatalogIntegration, embedder: Embedder, client: RedisClient, limit: number): Promise<KnnHit[]> {
  try {
    await ready(client);
    // índice recém-criado está vazio: reconstrói em segundo plano e responde com o que houver
    if (await ensureBookIndex(embedder, client)) void reconcileBookIndex(integration, embedder, client);
    const [vector] = await embedder.embed([q], "query");
    return await knnSearch(vector!, limit, client);
  } catch (error) {
    console.warn("Busca semântica indisponível:", (error as Error).message);
    throw new ServiceUnavailable("A busca semântica está indisponível no momento");
  }
}

/**
 * UC24: transforma a consulta em vetor, pede ao Redis os livros mais próximos e
 * descarta os que estão longe demais: o KNN sempre devolve `limit` vizinhos,
 * mesmo para uma consulta sem relação nenhuma com o acervo.
 */
export async function searchBooksSemantically(
  term: string,
  integration: CatalogIntegration,
  { embedder = defaultEmbedder, client = redis, limit = 10, now = new Date() }:
    { embedder?: Embedder | null; client?: RedisClient | null; limit?: number; now?: Date } = {},
): Promise<{ book: BookView; distance: number }[]> {
  const q = term.trim();
  if (q === "") throw new InvalidInput("Informe o que você procura");
  if (q.length > MAX_LENGTH) throw new InvalidInput(`A busca aceita até ${MAX_LENGTH} caracteres`);
  if (!embedder || !client) throw new ServiceUnavailable("A busca semântica está indisponível no momento");

  const hits = (await nearestBooks(q, integration, embedder, client, limit)).filter((hit) => hit.distance <= embedder.maxDistance);
  if (hits.length === 0) return [];

  // o Postgres é a fonte da verdade: um livro excluído que ainda esteja no índice fica de fora
  const rows = await sql`SELECT id, isbn, titulo AS title, autor_id AS "authorId", data_catalogacao AS "catalogedOn" FROM livros WHERE id IN ${sql(hits.map((hit) => hit.id))}` as BookRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const today = civilDate(now);
  const results: { book: BookView; distance: number }[] = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (row) results.push({ book: await toBookView(sql, row, integration, today), distance: hit.distance });
  }
  return results;
}
