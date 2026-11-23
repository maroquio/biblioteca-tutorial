import type { TransactionSQL } from "bun";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogDb, CatalogIntegration } from "../domain/CatalogIntegration";

type IndexModel = { modelo: string; dimensoes: number; geracao: string };
type IndexResult = { indexed: number };
type BookText = { id: number; text: string; indexedText: string | null };

async function indexModel(db: CatalogDb): Promise<IndexModel | undefined> {
  const [model] = await db`SELECT modelo, dimensoes, geracao FROM acervo_vetores_modelo WHERE unico` as IndexModel[];
  return model;
}

function matches(model: IndexModel | undefined, embedder: Embedder): model is IndexModel {
  return model?.modelo === embedder.id && model.dimensoes === embedder.dimensions;
}

async function ensureBookIndex(tx: TransactionSQL, embedder: Embedder): Promise<{ model: IndexModel; created: boolean }> {
  const current = await indexModel(tx);
  if (matches(current, embedder)) return { model: current, created: false };

  const dimensions = embedder.dimensions;
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 2000) {
    throw new Error("A dimensão do embedder precisa estar entre 1 e 2000 para o índice HNSW");
  }

  await tx`DROP TABLE IF EXISTS acervo_livros_vetores`;
  // O tipo da coluna exige um literal. A dimensão acima foi validada como inteiro.
  await tx.unsafe(`
    CREATE TABLE acervo_livros_vetores (
      livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
      texto TEXT NOT NULL,
      embedding vector(${dimensions}) NOT NULL
    )
  `);
  await tx`CREATE INDEX acervo_livros_vetores_hnsw ON acervo_livros_vetores USING hnsw (embedding vector_cosine_ops)`;
  const model = { modelo: embedder.id, dimensoes: dimensions, geracao: crypto.randomUUID() };
  await tx`
    INSERT INTO acervo_vetores_modelo (unico, modelo, dimensoes, geracao)
    VALUES (true, ${model.modelo}, ${model.dimensoes}, ${model.geracao})
    ON CONFLICT (unico) DO UPDATE SET
      modelo = EXCLUDED.modelo, dimensoes = EXCLUDED.dimensoes, geracao = EXCLUDED.geracao
  `;
  return { model, created: true };
}

async function bookTexts(db: CatalogDb, integration: CatalogIntegration, ids?: number[]): Promise<BookText[]> {
  const rows = await db`
    SELECT l.id, l.titulo, l.autor_id, v.texto AS "indexedText"
    FROM livros l LEFT JOIN acervo_livros_vetores v ON v.livro_id = l.id
    ${ids ? db`WHERE l.id IN ${db(ids)}` : db``}
  ` as { id: number; titulo: string; autor_id: number; indexedText: string | null }[];

  const texts: BookText[] = [];
  for (const row of rows) {
    const author = await integration.author(db, row.autor_id);
    const text = author ? `${row.titulo} — ${author.name}` : row.titulo;
    texts.push({ id: row.id, text, indexedText: row.indexedText });
  }
  return texts;
}

function vectorLiteral(vector: Float32Array): string {
  return `[${vector.join(",")}]`;
}

async function syncVectors(integration: CatalogIntegration, embedder: Embedder | null, ids?: number[]): Promise<IndexResult> {
  if (!embedder || ids?.length === 0) return { indexed: 0 };
  try {
    const { model, pending } = await inTransaction(async (tx) => {
      const { model, created } = await ensureBookIndex(tx, embedder);
      const books = await bookTexts(tx, integration, created ? undefined : ids);
      return { model, pending: books.filter((book) => book.text !== book.indexedText) };
    });
    if (pending.length === 0) return { indexed: 0 };

    const vectors = await embedder.embed(pending.map((book) => book.text), "document");
    if (vectors.length !== pending.length || vectors.some((vector) => vector.length !== embedder.dimensions)) {
      throw new Error("O embedder devolveu vetores incompatíveis com o índice");
    }

    return await inTransaction(async (tx) => {
      // Uma troca de modelo ou edição concorrente pode ter ocorrido durante o embedding.
      if ((await indexModel(tx))?.geracao !== model.geracao) return { indexed: 0 };
      const current = new Map((await bookTexts(tx, integration, pending.map((book) => book.id)))
        .map((book) => [book.id, book]));
      let indexed = 0;
      for (const [i, book] of pending.entries()) {
        const latest = current.get(book.id);
        if (latest?.text !== book.text || latest.indexedText === book.text) continue;
        await tx`
          INSERT INTO acervo_livros_vetores (livro_id, texto, embedding)
          VALUES (${book.id}, ${book.text}, ${vectorLiteral(vectors[i]!)}::vector)
          ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, embedding = EXCLUDED.embedding
        `;
        indexed++;
      }
      return { indexed };
    });
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
    return { indexed: 0 };
  }
}

/** Chamado após o COMMIT. Uma falha no embedding deixa a atualização para a reconciliação. */
export function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder = defaultEmbedder): Promise<IndexResult> {
  return syncVectors(integration, embedder, ids);
}

export function reconcileBookIndex(integration: CatalogIntegration, embedder = defaultEmbedder): Promise<IndexResult> {
  return syncVectors(integration, embedder);
}

export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Índice semântico indisponível:", (error as Error).message);
  }
}

export type KnnHit = { id: number; distance: number };

export async function knnSearch(query: string, limit: number, integration: CatalogIntegration, embedder: Embedder): Promise<KnnHit[]> {
  if (!matches(await indexModel(sql), embedder)) await reconcileBookIndex(integration, embedder);
  const [vector] = await embedder.embed([query], "query");
  if (vector?.length !== embedder.dimensions) throw new Error("Vetor de consulta incompatível com o índice");

  return inTransaction(async (tx) => {
    if (!matches(await indexModel(tx), embedder)) throw new Error("O modelo do índice semântico mudou");
    return await tx`
      SELECT livro_id AS id, embedding <=> ${vectorLiteral(vector)}::vector AS distance
      FROM acervo_livros_vetores
      ORDER BY distance
      LIMIT ${limit}
    ` as KnnHit[];
  });
}
