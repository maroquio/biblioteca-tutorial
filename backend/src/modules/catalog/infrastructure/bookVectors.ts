import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { sql } from "../../../infrastructure/postgres";
import { inTransaction } from "../../../infrastructure/transaction";
import type { Embedder } from "../../../shared/Embedder";
import type { CatalogDb, CatalogIntegration } from "../domain/CatalogIntegration";

/**
 * Vetores dos livros no próprio Postgres, com o pgvector. Cada livro tem uma
 * linha em `livros_vetores` com o texto que o modelo leu e o vetor dele; o índice
 * HNSW (distância cosseno) acha os vizinhos mais próximos de uma consulta.
 *
 * Continua sendo um dado derivado: tudo aqui pode ser apagado e recalculado a
 * partir de `livros`. A diferença para o Redis é que agora ele mora ao lado da
 * fonte da verdade: a chave estrangeira com ON DELETE CASCADE apaga o vetor na
 * mesma transação do DELETE do livro, e não existem mais órfãos.
 *
 * A dimensão da coluna depende do embedder (1024 no hash, 768 no Gemini), por
 * isso a tabela não nasce no prepareCatalog: quem a cria é o ensureBookIndex.
 */

/** O HNSW do pgvector indexa o tipo `vector` com até 2000 dimensões. */
const MAX_HNSW_DIMENSIONS = 2000;

/**
 * `removed` fica sempre 0: com a chave estrangeira e o ON DELETE CASCADE, o vetor
 * sai junto com o livro, e não existem órfãos para remover. O campo continua para
 * o contrato público do módulo (que o src/integration usa) não mudar.
 */
export type IndexResult = { indexed: number; removed: number };
export type KnnHit = { id: number; distance: number };

/** O formato de texto do pgvector: "[0.9,0.1,0]". O `::vector` do SQL faz a conversão. */
export function toPgvector(vector: Float32Array): string {
  return `[${Array.from(vector).join(",")}]`;
}

/** Literal de texto do SQL padrão: aspas simples dobradas. */
function sqlLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

/**
 * O modelo que criou a tabela fica no comentário dela, e a dimensão no tipo da
 * coluna. Os dois vivem junto com a tabela: um DROP TABLE leva tudo, e não há
 * como o "registro do modelo" e os vetores divergirem, como podia acontecer com
 * a chave acervo:livros:modelo do Redis. Sem a tabela, as duas colunas vêm nulas.
 */
async function describeTable(db: CatalogDb): Promise<{ model: string | null; type: string | null }> {
  const [row] = await db`
    SELECT obj_description(to_regclass('livros_vetores'), 'pg_class') AS model,
           (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
             WHERE attrelid = to_regclass('livros_vetores') AND attname = 'vetor') AS type
  ` as { model: string | null; type: string | null }[];
  return row!;
}

function isCurrent(table: { model: string | null; type: string | null }, embedder: Embedder): boolean {
  return table.model === embedder.id && table.type === `vector(${embedder.dimensions})`;
}

/**
 * Garante que a tabela de vetores existe para este embedder e diz se precisou
 * criá-la (quem chamou dispara a reconciliação, como fazia o Redis).
 *
 * Só a dimensão não basta: dois modelos de 768 dimensões produzem vetores que
 * não se comparam. Por isso o embedder.id (modelo + dimensão) também é conferido.
 * Mudou o modelo, a tabela é apagada e criada de novo com a dimensão nova.
 *
 * O caminho comum é uma consulta ao catálogo, sem lock. A recriação, rara (a
 * primeira subida ou uma troca de modelo), roda numa transação com o mesmo lock
 * das escritas: o DDL é atômico, duas chamadas simultâneas não recriam a tabela
 * duas vezes, e nenhuma escrita de livro fica pela metade enquanto ela some.
 */
export async function ensureBookIndex(embedder: Embedder): Promise<boolean> {
  if (isCurrent(await describeTable(sql), embedder)) return false;

  const dimensions = embedder.dimensions;
  // vector(N) faz parte da estrutura do comando e não aceita parâmetro ($1):
  // o texto vai cru para o banco, então o número é validado antes
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_HNSW_DIMENSIONS) {
    throw new Error(`Dimensão inválida para o índice HNSW: ${dimensions}`);
  }
  return await inTransaction(async (tx) => {
    // outra chamada pode ter criado a tabela enquanto esta esperava o lock
    if (isCurrent(await describeTable(tx), embedder)) return false;
    await tx`DROP TABLE IF EXISTS livros_vetores`;
    await tx.unsafe(`
      CREATE TABLE livros_vetores (
        livro_id INTEGER PRIMARY KEY REFERENCES livros(id) ON DELETE CASCADE,
        texto TEXT NOT NULL,
        vetor vector(${dimensions}) NOT NULL
      )
    `);
    // o operador da busca (<=>) e a classe de operadores precisam combinar
    await tx`CREATE INDEX livros_vetores_vetor_idx ON livros_vetores USING hnsw (vetor vector_cosine_ops)`;
    await tx.unsafe(`COMMENT ON TABLE livros_vetores IS ${sqlLiteral(embedder.id)}`);
    return true;
  });
}

/** O que o modelo lê de cada livro: o título e, para dar contexto, o autor. */
function indexText(title: string, authorName: string | undefined): string {
  return authorName ? `${title} — ${authorName}` : title;
}

type StoredBook = { id: number; title: string; authorId: number; storedText: string | null };

/** Os livros com o texto que está gravado ao lado do vetor (null: livro ainda sem vetor). */
async function storedBooks(ids: number[] | "all"): Promise<StoredBook[]> {
  if (ids === "all") {
    return await sql`
      SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "storedText"
      FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id
    ` as StoredBook[];
  }
  return await sql`
    SELECT l.id, l.titulo AS title, l.autor_id AS "authorId", v.texto AS "storedText"
    FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id
    WHERE l.id IN ${sql(ids)}
  ` as StoredBook[];
}

/**
 * Recalcula o vetor dos livros cujo texto mudou (ou que ainda não têm vetor).
 * Só esses pagam o embedding: o texto gravado é a régua, e um livro em dia não
 * chama o embedder. Não precisa mais conferir o tamanho do vetor, como o
 * HSTRLEN fazia no Redis: a coluna vector(N) recusa a dimensão errada na hora.
 */
async function syncIds(ids: number[] | "all", integration: CatalogIntegration, embedder: Embedder | null): Promise<IndexResult & { created: boolean }> {
  const result = { indexed: 0, removed: 0, created: false };
  // um livro excluído já levou o vetor junto (ON DELETE CASCADE): sem embedder, não há o que fazer
  if (!embedder) return result;
  const unique = ids === "all" ? ids : [...new Set(ids)];
  if (unique !== "all" && unique.length === 0) return result;

  result.created = await ensureBookIndex(embedder);
  const books = await storedBooks(unique);

  const authors = new Map<number, string | undefined>();
  const pending: { id: number; title: string; authorId: number; text: string }[] = [];
  for (const book of books) {
    if (!authors.has(book.authorId)) authors.set(book.authorId, (await integration.author(sql, book.authorId))?.name);
    const text = indexText(book.title, authors.get(book.authorId));
    if (text !== book.storedText) pending.push({ id: book.id, title: book.title, authorId: book.authorId, text });
  }
  if (pending.length === 0) return result;

  // a chamada ao embedder (Gemini: rede, até 10 s) fica fora de qualquer transação
  const vectors = await embedder.embed(pending.map((item) => item.text), "document");
  for (const [i, item] of pending.entries()) {
    // upsert condicional: só grava se o livro ainda existe com o título e o autor que
    // o modelo leu. Uma sincronização atrasada (o livro foi editado ou excluído
    // enquanto o Gemini respondia) não sobrescreve um vetor mais novo nem esbarra
    // na chave estrangeira.
    const written = await sql`
      INSERT INTO livros_vetores (livro_id, texto, vetor)
      SELECT id, ${item.text}, ${toPgvector(vectors[i]!)}::vector
      FROM livros
      WHERE id = ${item.id} AND titulo = ${item.title} AND autor_id = ${item.authorId}
      ON CONFLICT (livro_id) DO UPDATE SET texto = EXCLUDED.texto, vetor = EXCLUDED.vetor
      RETURNING livro_id
    `;
    result.indexed += written.length;
  }
  return result;
}

/**
 * Atualiza os vetores destes livros, depois do COMMIT. Nunca lança: com o
 * Gemini fora do ar o livro fica sem vetor (ou com o vetor antigo) até a próxima
 * reconciliação, e a escrita em `livros`, que é o que importa, já aconteceu.
 */
export async function syncBookIndex(ids: number[], integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds(ids, integration, embedder);
    // tabela nova (primeira subida, modelo trocado): os outros livros também precisam de vetor
    if (created) void reconcileBookIndex(integration, embedder);
    return result;
  } catch (error) {
    console.warn("Vetores da busca semântica indisponíveis:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/**
 * Compara todos os livros com os vetores gravados: dá vetor a quem não tem (o
 * seed escreve direto em `livros`; o Gemini estava fora quando o livro foi
 * cadastrado) e refaz os de texto desatualizado (autor renomeado com o Gemini
 * fora). Órfãos não existem: a chave estrangeira não deixa. Nunca lança.
 */
export async function reconcileBookIndex(integration: CatalogIntegration, embedder: Embedder | null = defaultEmbedder): Promise<IndexResult> {
  try {
    const { created, ...result } = await syncIds("all", integration, embedder);
    return result;
  } catch (error) {
    console.warn("Vetores da busca semântica indisponíveis:", (error as Error).message);
    return { indexed: 0, removed: 0 };
  }
}

/** O nome do autor faz parte do texto indexado: renomeá-lo refaz o vetor dos livros dele. */
export async function syncAuthorBookIndex(authorId: number, integration: CatalogIntegration): Promise<void> {
  try {
    const rows = await sql`SELECT id FROM livros WHERE autor_id = ${authorId}` as { id: number }[];
    await syncBookIndex(rows.map((row) => row.id), integration);
  } catch (error) {
    console.warn("Vetores da busca semântica indisponíveis:", (error as Error).message);
  }
}

/**
 * Os até `limit` livros mais próximos do vetor, do mais perto para o mais longe,
 * descartando os que estão além de `maxDistance`: o KNN sempre devolve `limit`
 * vizinhos, mesmo para uma consulta sem relação nenhuma com o acervo.
 *
 * O par ORDER BY vetor <=> consulta LIMIT n, com a expressão no ORDER BY, é a
 * forma que o índice HNSW sabe acelerar; o corte pelo limiar fica na consulta de
 * fora, para não atrapalhar o índice. `<=>` é 1 − cos(θ), o mesmo número que o
 * DISTANCE_METRIC COSINE do Redis devolvia: o limiar calibrado continua valendo.
 */
export async function knnSearch(vector: Float32Array, { limit, maxDistance }: { limit: number; maxDistance: number }): Promise<KnnHit[]> {
  const query = toPgvector(vector);
  return await sql`
    SELECT livro_id AS id, distancia AS distance
    FROM (
      SELECT livro_id, vetor <=> ${query}::vector AS distancia
      FROM livros_vetores
      ORDER BY vetor <=> ${query}::vector
      LIMIT ${limit}
    ) AS vizinhos
    WHERE distancia <= ${maxDistance}
    ORDER BY distancia
  ` as KnnHit[];
}
