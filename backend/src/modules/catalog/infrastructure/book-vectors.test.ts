import { expect, spyOn, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { nearestBookVectors, reconcileBookIndex, syncBookIndex } from "./bookVectors";
import { prepareCatalog } from "./schema";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro grava um vetor de verdade, sem rede
const base = createHashEmbedder();

async function storedVector(id: number): Promise<{ text: string; dims: number } | null> {
  const [row] = await sql`SELECT texto AS text, vector_dims(embedding) AS dims FROM livros_vetores WHERE livro_id = ${id}` as { text: string; dims: number }[];
  return row ?? null;
}

async function columnType(): Promise<string> {
  const [row] = await sql`
    SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
    WHERE attrelid = 'livros_vetores'::regclass AND attname = 'embedding'
  ` as { type: string }[];
  return row!.type;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

function token(): string {
  return crypto.randomUUID().slice(0, 8);
}

test("UC24: livro cadastrado ganha vetor com título e autor, na dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${token()}`;
  const book = await createBook(title, author.id);
  expect(await storedVector(book.id)).toEqual({ text: `${title} — ${author.nome}`, dims: base.dimensions });
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const [before] = await sql`SELECT embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}` as { v: string }[];
  const title = `Novo título ${token()}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const [after] = await sql`SELECT embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}` as { v: string }[];
  expect((await storedVector(book.id))!.text).toBe(`${title} — ${author.nome}`);
  expect(after!.v).not.toBe(before!.v);
});

test("UC24: excluir o livro remove a linha de vetor (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  expect(await storedVector(book.id)).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await storedVector(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const name = `Autora ${token()}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await storedVector(book.id))!.text).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL (como o seed) ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const title = `Do seed ${token()}`;
  const [row] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  try {
    expect(await storedVector(row!.id)).toBeNull();
    const result = await reconcileBookIndex(catalogIntegration, base);
    expect(result.indexed).toBeGreaterThanOrEqual(1);
    expect(await storedVector(row!.id)).toEqual({ text: `${title} — ${author.nome}`, dims: base.dimensions });
  } finally {
    await sql`DELETE FROM livros WHERE id = ${row!.id}`;
  }
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);
  // texto desatualizado (o autor foi renomeado com o Gemini fora do ar): aí sim, reembeda
  await sql`UPDATE livros_vetores SET texto = 'desatualizado' WHERE livro_id = ${book.id}`;
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 1, removed: 0 });
  expect(calls).toBe(1);
});

test("UC24: com o embedder fora do ar a sincronização não lança e o livro continua cadastrado", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  await sql`DELETE FROM livros_vetores WHERE livro_id = ${book.id}`;
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([book.id], catalogIntegration, down)).toEqual({ indexed: 0, removed: 0 });
  expect(await reconcileBookIndex(catalogIntegration, down)).toEqual({ indexed: 0, removed: 0 });
  expect((await api("GET", `/livros/${book.id}`)).status).toBe(200);
  expect(await storedVector(book.id)).toBeNull();
  // quando o embedder volta, a reconciliação preenche o que faltou
  await reconcileBookIndex(catalogIntegration, base);
  expect(await storedVector(book.id)).not.toBeNull();
});

test("UC24: com o embedder fora do ar, cadastrar e editar pela API continuam funcionando", async () => {
  // o mesmo objeto que o createBook usa: mesmo id e mesma dimensão, então a tabela não é recriada
  const failing = spyOn(defaultEmbedder!, "embed").mockImplementation(async () => { throw new Error("fora do ar"); });
  let book: { id: number; isbn: string };
  const author = await testAuthor();
  try {
    book = await createBook(`Livro ${token()}`, author.id);
    expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: `Outro ${token()}`, autorId: author.id })).status).toBe(200);
    expect(failing).toHaveBeenCalled();
    expect(await storedVector(book.id)).toBeNull();
  } finally {
    failing.mockRestore();
  }
  // o livro ficou sem vetor até a próxima reconciliação
  await reconcileBookIndex(catalogIntegration);
  expect(await storedVector(book!.id)).not.toBeNull();
});

test("UC24: embedder de outra dimensão refaz a tabela e reindexa", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const other = createHashEmbedder(512);
  try {
    // reconcile (e não sync) para não deixar uma reconciliação de 512 rodando em segundo plano
    await reconcileBookIndex(catalogIntegration, other);
    expect(await columnType()).toBe("vector(512)");
    expect((await storedVector(book.id))!.dims).toBe(512);
  } finally {
    // o banco de testes é compartilhado: devolve a tabela de 1024 aos outros testes
    await reconcileBookIndex(catalogIntegration, base);
  }
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  expect((await storedVector(book.id))!.dims).toBe(base.dimensions);
});

test("UC24: os vizinhos vêm do Postgres, do mais perto para o mais longe, com a distância como number", async () => {
  const author = await testAuthor();
  const tok = token();
  const near = await createBook(`Farol na tempestade ${tok}`, author.id);
  const [vector] = await base.embed([`farol tempestade ${tok}`], "query");
  const hits = await nearestBookVectors(vector!, 5);
  expect(hits[0]!.id).toBe(near.id);
  expect(typeof hits[0]!.distance).toBe("number");
  for (let i = 1; i < hits.length; i++) expect(hits[i]!.distance).toBeGreaterThanOrEqual(hits[i - 1]!.distance);
});

test("UC24: o índice é HNSW com distância cosseno e a busca pode usá-lo", async () => {
  const [index] = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexdef ILIKE '%hnsw%'` as { indexdef: string }[];
  expect(index!.indexdef).toContain("vector_cosine_ops");
  const [vector] = await base.embed(["qualquer coisa"], "query");
  const query = `[${Array.from(vector!).join(",")}]`;
  const plan = await sql.begin(async (tx) => {
    await tx`SET LOCAL enable_seqscan = off`;
    return await tx`EXPLAIN SELECT livro_id FROM livros_vetores ORDER BY embedding <=> ${query}::vector LIMIT 10`;
  }) as { "QUERY PLAN": string }[];
  expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("livros_vetores_embedding_idx");
});

test("UC24: a extensão vector é criada pela aplicação, e preparar de novo não falha", async () => {
  await prepareCatalog();
  await prepareCatalog();
  const [row] = await sql`SELECT extversion FROM pg_extension WHERE extname = 'vector'` as { extversion: string }[];
  expect(row).toBeDefined();
});

test("UC24: nada no caminho da indexação e da busca semântica importa o Redis", async () => {
  const files = [
    "src/modules/catalog/infrastructure/bookVectors.ts",
    "src/modules/catalog/infrastructure/schema.ts",
    "src/modules/catalog/features/semantic-search-books/searchBooksSemantically.ts",
    "src/modules/catalog/features/semantic-search-books/route.ts",
    "src/modules/catalog/features/create-book/createBook.ts",
    "src/modules/catalog/features/update-book/updateBook.ts",
    "src/modules/catalog/features/delete-book/deleteBook.ts",
  ];
  for (const file of files) {
    expect(await Bun.file(new URL(`../../../../${file}`, import.meta.url)).text()).not.toContain("infrastructure/redis");
  }
});
