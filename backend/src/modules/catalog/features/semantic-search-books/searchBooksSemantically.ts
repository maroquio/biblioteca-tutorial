
import { embedder as defaultEmbedder } from "../../../../infrastructure/embedder";
import { sql } from "../../../../infrastructure/postgres";
import { civilDate } from "../../../../shared/dates";
import type { Embedder } from "../../../../shared/Embedder";
import { InvalidInput, ServiceUnavailable } from "../../../../shared/errors";
import type { BookView } from "../../domain/Book";
import type { CatalogIntegration } from "../../domain/CatalogIntegration";
import { ensureBookVectors, reconcileBookVectors } from "../../infrastructure/bookVectors";
import { toBookView, type BookRow } from "../../infrastructure/books";

const MAX_LENGTH = 200;

type KnnHit = {
  id: number;
  distance: number;
};

/**
 * Transforma a consulta em vetor e procura os livros
 * mais próximos diretamente no PostgreSQL com pgvector.
 */
async function nearestBooks(
  q: string,
  integration: CatalogIntegration,
  embedder: Embedder,
  limit: number,
): Promise<KnnHit[]> {
  try {
    // Garante que a tabela vetorial corresponda ao modelo utilizado.
    const created = await ensureBookVectors(embedder);

    // Se a tabela foi criada ou recriada, reconstrói o índice
    // em segundo plano a partir dos livros existentes.
    if (created) {
      void reconcileBookVectors(integration, embedder).catch((error) => {
        console.warn(
          "Reconciliação do índice vetorial indisponível:",
          (error as Error).message,
        );
      });
    }

    // Transforma a consulta do usuário em um vetor.
    const [vector] = await embedder.embed([q], "query");

    if (!vector || vector.length !== embedder.dimensions) {
      throw new Error("Dimensão do embedding da consulta é inválida");
    }

    // Converte o vetor para o formato aceito pelo pgvector.
    const serializedVector = `[${Array.from(vector).join(",")}]`;

    // O operador <=> calcula a distância cosseno entre os vetores.
    const hits = await sql`
      SELECT
        livro_id AS id,
        embedding <=> ${serializedVector}::vector AS distance
      FROM livros_vetores
      ORDER BY embedding <=> ${serializedVector}::vector
      LIMIT ${limit}
    ` as KnnHit[];

    return hits;
  } catch (error) {
    console.warn(
      "Busca semântica indisponível:",
      (error as Error).message,
    );

    throw new ServiceUnavailable(
      "A busca semântica está indisponível no momento",
    );
  }
}

/**
 * UC24: transforma a consulta em vetor, pede ao PostgreSQL
 * os livros mais próximos e descarta os que estão longe demais.
 */
export async function searchBooksSemantically(
  term: string,
  integration: CatalogIntegration,
  {
    embedder = defaultEmbedder,
    limit = 10,
    now = new Date(),
  }: {
    embedder?: Embedder | null;
    limit?: number;
    now?: Date;
  } = {},
): Promise<{ book: BookView; distance: number }[]> {
  const q = term.trim();

  if (q === "") {
    throw new InvalidInput("Informe o que você procura");
  }

  if (q.length > MAX_LENGTH) {
    throw new InvalidInput(
      `A busca aceita até ${MAX_LENGTH} caracteres`,
    );
  }

  if (!embedder) {
    throw new ServiceUnavailable(
      "A busca semântica está indisponível no momento",
    );
  }

  const hits = (
    await nearestBooks(q, integration, embedder, limit)
  ).filter((hit) => hit.distance <= embedder.maxDistance);

  if (hits.length === 0) return [];

  // O PostgreSQL continua sendo a fonte da verdade.
  const rows = await sql`
    SELECT
      id,
      isbn,
      titulo AS title,
      autor_id AS "authorId",
      data_catalogacao AS "catalogedOn"
    FROM livros
    WHERE id IN ${sql(hits.map((hit) => hit.id))}
  ` as BookRow[];

  const byId = new Map(rows.map((row) => [row.id, row]));
  const today = civilDate(now);

  const results: { book: BookView; distance: number }[] = [];

  for (const hit of hits) {
    const row = byId.get(hit.id);

    if (row) {
      results.push({
        book: await toBookView(sql, row, integration, today),
        distance: hit.distance,
      });
    }
  }

  return results;
}
