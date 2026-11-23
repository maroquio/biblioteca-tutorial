import { expect, spyOn, test } from "bun:test";
import { api, testAuthor, testIsbn, testName } from "#tests/api";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { ServiceUnavailable } from "../../../shared/errors";
import { searchBooksSemantically } from "../features/semantic-search-books/searchBooksSemantically";
import { ensureBookIndex, knnSearch, reconcileBookIndex, syncBookIndex } from "./bookVectors";
import { prepareCatalog } from "./schema";

const base = createHashEmbedder();

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

async function storedVector(id: number) {
  const [row] = await sql`
    SELECT texto AS text, embedding::text AS vector, vector_dims(embedding) AS dimensions
    FROM livros_vetores WHERE livro_id = ${id}
  ` as { text: string; vector: string; dimensions: number }[];
  return row;
}

async function insertBook(title: string, authorId: number): Promise<{ id: number }> {
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${authorId}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  return book!;
}

test("UC24: preparar o Acervo cria a extensão de forma idempotente", async () => {
  await prepareCatalog();
  await prepareCatalog();
  const extensions = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
  expect(extensions).toHaveLength(1);
});

test("UC24: cadastro grava título, autor e vetor da dimensão do embedder no Postgres", async () => {
  const author = await testAuthor();
  const title = testName("Livro vetorial");
  const book = await createBook(title, author.id);
  const row = await storedVector(book.id);
  expect(row?.text).toBe(`${title} — ${author.nome}`);
  expect(row?.dimensions).toBe(base.dimensions);
  const [expected] = await base.embed([row!.text], "document");
  expect(JSON.parse(row!.vector)).toEqual(Array.from(expected!));
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Astronomia"), author.id);
  const previous = await storedVector(book.id);
  const title = testName("Receitas culinárias");
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const current = await storedVector(book.id);
  expect(current?.text).toBe(`${title} — ${author.nome}`);
  expect(current?.vector).not.toBe(previous?.vector);
  const [expected] = await base.embed([current!.text], "document");
  expect(JSON.parse(current!.vector)).toEqual(Array.from(expected!));
});

test("UC24: editar o autor do livro atualiza seu vetor", async () => {
  const author = await testAuthor();
  const other = await testAuthor();
  const title = testName("Autoria");
  const book = await createBook(title, author.id);
  const previous = await storedVector(book.id);
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: other.id })).status).toBe(200);
  expect((await storedVector(book.id))?.text).toBe(`${title} — ${other.nome}`);
  expect((await storedVector(book.id))?.vector).not.toBe(previous?.vector);
});

test("UC24: excluir pela API remove a linha de vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Exclusão"), author.id);
  expect(await storedVector(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await storedVector(book.id)).toBeUndefined();
});

test("UC24: DELETE direto em livros remove o vetor por cascata", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Cascata"), author.id);
  expect(await storedVector(book.id)).toBeDefined();
  await sql`DELETE FROM livros WHERE id = ${book.id}`;
  expect(await storedVector(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza texto e vetor de todos os seus livros", async () => {
  const author = await testAuthor();
  const books = [
    await createBook(testName("Primeiro"), author.id),
    await createBook(testName("Segundo"), author.id),
  ];
  const previous = await Promise.all(books.map((book) => storedVector(book.id)));
  const name = testName("Autora renomeada");
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  for (const [i, book] of books.entries()) {
    const current = await storedVector(book.id);
    expect(current?.text).toEndWith(`— ${name}`);
    expect(current?.vector).not.toBe(previous[i]?.vector);
  }
});

test("UC24: reconciliação indexa livro inserido diretamente por SQL", async () => {
  const author = await testAuthor();
  const title = testName("Inserção direta");
  const book = await insertBook(title, author.id);
  expect(await storedVector(book.id)).toBeUndefined();
  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThanOrEqual(1);
  expect((await storedVector(book.id))?.text).toBe(`${title} — ${author.nome}`);
  expect((await storedVector(book.id))?.dimensions).toBe(base.dimensions);
});

test("UC24: reconciliação corrige texto desatualizado do título e do autor", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Texto antigo"), author.id);
  const previous = await storedVector(book.id);
  const title = testName("Texto atual");
  const name = testName("Autor atualizado");
  await sql`UPDATE livros SET titulo = ${title} WHERE id = ${book.id}`;
  await sql`UPDATE autores SET nome = ${name} WHERE id = ${author.id}`;
  await reconcileBookIndex(catalogIntegration);
  const current = await storedVector(book.id);
  expect(current?.text).toBe(`${title} — ${name}`);
  expect(current?.vector).not.toBe(previous?.vector);
});

test("UC24: sincronizar texto igual não chama o embedder nem duplica linhas", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Sem mudanças"), author.id);
  let calls = 0;
  const counted: Embedder = { ...base, embed: async (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id, book.id], catalogIntegration, counted)).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);
  const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM livros_vetores WHERE livro_id = ${book.id}`;
  expect(count).toBe(1);
});

test("UC24: falha do embedder não lança e a reconciliação recupera o vetor", async () => {
  const author = await testAuthor();
  const book = await insertBook(testName("Falha temporária"), author.id);
  const broken: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([book.id], catalogIntegration, broken)).toEqual({ indexed: 0, removed: 0 });
  expect(await storedVector(book.id)).toBeUndefined();
  await reconcileBookIndex(catalogIntegration);
  expect(await storedVector(book.id)).toBeDefined();
});

test("UC24: livro excluído durante o embedding não volta ao índice", async () => {
  const author = await testAuthor();
  const book = await insertBook(testName("Exclusão durante indexação"), author.id);
  const deleting: Embedder = {
    ...base,
    embed: async (texts, purpose) => {
      await sql`DELETE FROM livros WHERE id = ${book.id}`;
      return base.embed(texts, purpose);
    },
  };
  const warnings = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(await syncBookIndex([book.id], catalogIntegration, deleting)).toEqual({ indexed: 0, removed: 0 });
    expect(await storedVector(book.id)).toBeUndefined();
    expect(warnings).not.toHaveBeenCalled();
  } finally {
    warnings.mockRestore();
  }
});

test("UC24: cadastro já está em COMMIT e responde 201 mesmo quando o embedder falha", async () => {
  const author = await testAuthor();
  const title = testName("Cadastro preservado");
  let committed = false;
  const unavailable = spyOn(defaultEmbedder!, "embed").mockImplementation(async () => {
    const [book] = await sql`SELECT id FROM livros WHERE titulo = ${title}`;
    committed = Boolean(book);
    throw new Error("fora do ar");
  });
  try {
    const book = await createBook(title, author.id);
    expect(committed).toBe(true);
    expect(await storedVector(book.id)).toBeUndefined();
    expect((await api("GET", `/livros/id/${book.id}`)).status).toBe(200);
  } finally {
    unavailable.mockRestore();
    await reconcileBookIndex(catalogIntegration);
  }
});

test("UC24: sem embedder a sincronização e a reconciliação preservam os vetores", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Sem provedor"), author.id);
  const previous = await storedVector(book.id);
  expect(await syncBookIndex([book.id], catalogIntegration, null)).toEqual({ indexed: 0, removed: 0 });
  expect(await reconcileBookIndex(catalogIntegration, null)).toEqual({ indexed: 0, removed: 0 });
  expect(await storedVector(book.id)).toEqual(previous);
});

test("UC24: outra dimensão recria a coluna e reindexa todos os livros", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Outra dimensão"), author.id);
  const other = createHashEmbedder(512);
  try {
    const result = await reconcileBookIndex(catalogIntegration, other);
    expect(result.indexed).toBeGreaterThan(0);
    const [column] = await sql`
      SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
      WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
    `;
    expect(column?.type).toBe("vector(512)");
    expect((await storedVector(book.id))?.dimensions).toBe(512);
    const [missing] = await sql`
      SELECT COUNT(*)::int AS count FROM livros l
      LEFT JOIN livros_vetores v ON v.livro_id = l.id
      WHERE v.livro_id IS NULL OR vector_dims(v.embedding) <> 512
    `;
    expect(missing?.count).toBe(0);
  } finally {
    await reconcileBookIndex(catalogIntegration);
  }
  expect((await storedVector(book.id))?.dimensions).toBe(base.dimensions);
});

test("UC24: outro modelo com a mesma dimensão recria o índice mesmo vazio", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Outro modelo"), author.id);
  const other: Embedder = { ...base, id: "outro-modelo-1024" };
  try {
    expect(await ensureBookIndex(other)).toBe(true);
    expect(await storedVector(book.id)).toBeUndefined();
    expect(await ensureBookIndex(other)).toBe(false);
    expect(await ensureBookIndex(base)).toBe(true);
    await reconcileBookIndex(catalogIntegration);
    expect(await storedVector(book.id)).toBeDefined();
  } finally {
    await reconcileBookIndex(catalogIntegration);
  }
});

test("UC24: criar o índice repetidamente ou em paralelo preserva os vetores", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Idempotência"), author.id);
  const previous = await storedVector(book.id);
  expect(await Promise.all([ensureBookIndex(base), ensureBookIndex(base)])).toEqual([false, false]);
  expect(await storedVector(book.id)).toEqual(previous);
});

test("UC24: dimensão inválida é recusada antes de alterar a tabela", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Dimensão inválida"), author.id);
  const previous = await storedVector(book.id);
  for (const dimensions of [0, -1, 1.5, 2001, NaN, Infinity]) {
    await expect(ensureBookIndex({ ...base, dimensions })).rejects.toThrow("Dimensão inválida");
  }
  expect(await storedVector(book.id)).toEqual(previous);
});

test("UC24: KNN retorna distância cosseno numérica em ordem e respeita o limite", async () => {
  const author = await testAuthor();
  const title = testName("Vizinhos próximos");
  const book = await createBook(title, author.id);
  const [vector] = await base.embed([`${title} — ${author.nome}`], "query");
  const hits = await knnSearch(vector!, 2);
  expect(hits).toHaveLength(2);
  expect(hits[0]?.id).toBe(book.id);
  expect(typeof hits[0]?.distance).toBe("number");
  expect(hits[0]!.distance).toBeCloseTo(0, 6);
  expect(hits[0]!.distance).toBeLessThanOrEqual(hits[1]!.distance);
});

test("UC24: consulta cosseno pode usar o índice HNSW", async () => {
  const [vector] = await base.embed(["consulta"], "query");
  const query = `[${Array.from(vector!).join(",")}]`;
  const plan = await sql.begin(async (tx) => {
    await tx`SET LOCAL enable_seqscan = off`;
    return await tx`EXPLAIN SELECT livro_id FROM livros_vetores ORDER BY embedding <=> ${query}::vector LIMIT 10`;
  });
  expect(JSON.stringify(plan)).toContain("Index Scan using livros_vetores_embedding_idx");
});

test("UC24: falha do provedor na consulta retorna 503 e preserva os vetores", async () => {
  const author = await testAuthor();
  const book = await createBook(testName("Consulta indisponível"), author.id);
  const previous = await storedVector(book.id);
  const unavailable = spyOn(defaultEmbedder!, "embed").mockRejectedValue(new Error("fora do ar"));
  try {
    const response = await api("GET", "/busca-semantica/livros?q=consulta");
    expect(response.status).toBe(503);
    expect(await response.json<{ error: string }>()).toEqual({ error: "A busca semântica está indisponível no momento" });
    expect(await storedVector(book.id)).toEqual(previous);
    await expect(searchBooksSemantically("consulta", catalogIntegration, { embedder: null })).rejects.toBeInstanceOf(ServiceUnavailable);
  } finally {
    unavailable.mockRestore();
  }
});

test.each(["", "redis://127.0.0.1:1"])("UC24: servidor reconcilia na subida e busca com Redis ausente ou fora do ar (%s)", async (redisUrl) => {
  const author = await testAuthor();
  const title = testName("Servidor independente");
  const book = await insertBook(title, author.id);
  expect(await storedVector(book.id)).toBeUndefined();
  const server = Bun.spawn([process.execPath, "src/main.ts"], {
    env: { ...process.env, REDIS_URL: redisUrl, EMBEDDING_PROVIDER: "hash", GEMINI_API_KEY: "", PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const reader = server.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    let address: string | undefined;
    while (!address) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Servidor encerrou antes de iniciar: ${output}`);
      output += decoder.decode(chunk.value, { stream: true });
      address = output.match(/http:\/\/localhost:\d+/)?.[0];
    }
    reader.releaseLock();
    for (let attempt = 0; attempt < 100 && !await storedVector(book.id); attempt++) await Bun.sleep(10);
    expect((await storedVector(book.id))?.text).toBe(`${title} — ${author.nome}`);
    const response = await fetch(`${address}/api/busca-semantica/livros?q=${encodeURIComponent(title)}`);
    expect(response.status).toBe(200);
    const results = await response.json() as { id: number; distancia: number }[];
    expect(results[0]?.id).toBe(book.id);
    expect(typeof results[0]?.distancia).toBe("number");
  } finally {
    server.kill();
    await server.exited;
  }
});
