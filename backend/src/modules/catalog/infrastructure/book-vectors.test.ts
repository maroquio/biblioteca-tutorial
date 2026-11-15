import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import { createBook as createBookCase } from "../features/create-book/createBook";
import { reconcileBookIndex, syncBookIndex } from "./bookIndex";

async function stored(id: number): Promise<{ text: string; dimensions: number } | null> {
  const [row] = await sql`
    SELECT texto AS text, vector_dims(vetor) AS dimensions
    FROM livros_vetores WHERE livro_id = ${id}
  ` as { text: string; dimensions: number }[];
  return row ?? null;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

test("pgvector: cria extensão, tabela, FK e índice HNSW", async () => {
  const [extension] = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
  expect(extension).toBeDefined();
  const author = await testAuthor();
  await createBook(`Livro ${crypto.randomUUID()}`, author.id);
  const [index] = await sql`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'livros_vetores' AND indexname = 'livros_vetores_hnsw_idx'
  ` as { indexdef: string }[];
  expect(index?.indexdef).toContain("USING hnsw");
  expect(index?.indexdef).toContain("vector_cosine_ops");
  const [fk] = await sql`
    SELECT confdeltype FROM pg_constraint
    WHERE conrelid = 'livros_vetores'::regclass AND contype = 'f'
  ` as { confdeltype: string }[];
  expect(fk?.confdeltype).toBe("c"); // CASCADE
});

test("pgvector: cadastro, edição e exclusão atualizam os vetores", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID()}`, author.id);
  expect(await stored(book.id)).toEqual({
    text: expect.stringContaining(`— ${author.nome}`), dimensions: 1024,
  });

  const title = `Novo título ${crypto.randomUUID()}`;
  expect((await api("PUT", `/livros/${book.id}`, {
    isbn: book.isbn, titulo: title, autorId: author.id,
  })).status).toBe(200);
  expect((await stored(book.id))?.text).toBe(`${title} — ${author.nome}`);

  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await stored(book.id)).toBeNull();
});

test("pgvector: renomear autor atualiza o texto dos seus livros", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID()}`, author.id);
  const name = `Autora ${crypto.randomUUID()}`;
  expect((await api("PUT", `/autores/${author.id}`, {
    nome: name, tipo: "literatura",
  })).status).toBe(200);
  expect((await stored(book.id))?.text).toEndWith(`— ${name}`);
});

test("pgvector: texto igual não chama o embedder novamente", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID()}`, author.id);
  const base = createHashEmbedder();
  let calls = 0;
  const counting = {
    ...base,
    embed: async (texts: string[], purpose: "document" | "query") => {
      calls++;
      return base.embed(texts, purpose);
    },
  };
  await syncBookIndex([book.id], catalogIntegration, counting);
  expect(calls).toBe(0);
});

test("pgvector: falha do embedder não impede o cadastro", async () => {
  const author = await testAuthor();
  const base = createHashEmbedder();
  const broken = { ...base, embed: async (): Promise<Float32Array[]> => { throw new Error("fora do ar"); } };
  const book = await createBookCase(
    { isbn: testIsbn(), title: `Livro ${crypto.randomUUID()}`, authorId: author.id },
    catalogIntegration,
    new Date(),
    (ids, integration) => syncBookIndex(ids, integration, broken),
  );
  const [row] = await sql`SELECT id FROM livros WHERE id = ${book.id}`;
  expect(row).toBeDefined();
  expect(await stored(book.id)).toBeNull();
  await reconcileBookIndex(catalogIntegration);
  expect(await stored(book.id)).not.toBeNull();
});

test("pgvector: reconciliação encontra livro inserido diretamente", async () => {
  const author = await testAuthor();
  const title = `Livro do seed ${crypto.randomUUID()}`;
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-01-01')
    RETURNING id
  ` as { id: number }[];
  expect(await stored(book!.id)).toBeNull();
  await reconcileBookIndex(catalogIntegration);
  expect((await stored(book!.id))?.text).toBe(`${title} — ${author.nome}`);
});

test("pgvector: busca semântica responde sem consultar o cache Redis", async () => {
  // Fixture direto no Postgres: nenhum cadastro ou busca de autor precisa do Redis.
  const [author] = await sql`
    INSERT INTO autores (nome, tipo) VALUES (${`Autora ${crypto.randomUUID()}`}, 'literatura')
    RETURNING id
  ` as { id: number }[];
  const title = `Navegação espacial ${crypto.randomUUID()}`;
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author!.id}, '2026-01-01')
    RETURNING id
  ` as { id: number }[];
  await syncBookIndex([book!.id], catalogIntegration);

  const response = await api("GET", `/busca-semantica/livros?q=${encodeURIComponent(title)}`);
  expect(response.status).toBe(200);
  const results = await response.json() as { id: number; distancia: number }[];
  expect(results.some((item) => item.id === book!.id)).toBe(true);
});

test("pgvector: troca de dimensão reconstrói vetores e depois restaura o modelo", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID()}`, author.id);
  try {
    await reconcileBookIndex(catalogIntegration, createHashEmbedder(512));
    expect((await stored(book.id))?.dimensions).toBe(512);
  } finally {
    await reconcileBookIndex(catalogIntegration, createHashEmbedder());
  }
  expect((await stored(book.id))?.dimensions).toBe(1024);
});
