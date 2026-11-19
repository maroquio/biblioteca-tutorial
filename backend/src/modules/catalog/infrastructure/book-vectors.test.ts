import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { sql } from "../../../infrastructure/postgres";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { ensureBookVectors, reconcileBookIndex, syncBookIndex } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash (1024 dimensões): cada escrita de livro grava vetor de verdade, sem rede
const base = createHashEmbedder();

type Stored = { texto: string; dims: number };

async function stored(id: number): Promise<Stored | undefined> {
  const [row] = await sql`SELECT texto, vector_dims(embedding) AS dims FROM livros_vetores WHERE livro_id = ${id}` as Stored[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

const title = (prefix = "Livro") => `${prefix} ${crypto.randomUUID().slice(0, 8)}`;

test("pgvector: extensão, chave estrangeira com CASCADE e índice HNSW cosseno", async () => {
  await ensureBookVectors(base);
  const [extension] = await sql`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
  expect(extension).toBeDefined();
  const [fk] = await sql`SELECT confdeltype AS action FROM pg_constraint WHERE conrelid = 'livros_vetores'::regclass AND contype = 'f'`;
  expect(fk!.action).toBe("c");
  const [index] = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexdef ILIKE '%hnsw%'`;
  expect(index!.indexdef).toContain("vector_cosine_ops");
});

test("pgvector: ensure é idempotente para o mesmo embedder", async () => {
  await ensureBookVectors(base);
  expect(await ensureBookVectors(base)).toBe(false);
});

test("UC24: livro cadastrado grava texto e vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const name = title();
  const book = await createBook(name, author.id);
  expect(await stored(book.id)).toEqual({ texto: `${name} — ${author.nome}`, dims: base.dimensions });
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const [before] = await sql`SELECT embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}`;
  const name = title("Novo título");
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: name, autorId: author.id })).status).toBe(200);
  expect(await stored(book.id)).toEqual({ texto: `${name} — ${author.nome}`, dims: base.dimensions });
  const [after] = await sql`SELECT embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}`;
  expect(after!.v).not.toBe(before!.v);
});

test("UC24: excluir o livro remove a linha", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await stored(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await stored(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const name = title("Autora");
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await stored(book.id))!.texto).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL (como o seed) ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const name = title("Seed");
  const [row] = await sql`INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao) VALUES (${testIsbn()}, ${name}, ${author.id}, '2026-01-01') RETURNING id` as { id: number }[];
  expect(await stored(row!.id)).toBeUndefined();
  await reconcileBookIndex(catalogIntegration, base);
  expect(await stored(row!.id)).toEqual({ texto: `${name} — ${author.nome}`, dims: base.dimensions });
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
});

test("UC24: com um embedder que falha, a sincronização não lança", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  // mesmo id e mesma dimensão: senão o ensure acharia que o modelo mudou e recriaria a tabela
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  // texto novo no Postgres, para forçar a chamada ao embedder
  await sql`UPDATE livros SET titulo = ${title("Mudou")} WHERE id = ${book.id}`;
  expect(await syncBookIndex([book.id], catalogIntegration, down)).toEqual({ indexed: 0 });
  // o livro continua lá, só ficou com o vetor antigo até a próxima reconciliação
  expect((await sql`SELECT id FROM livros WHERE id = ${book.id}`).length).toBe(1);
});

test("UC24: sem embedder a sincronização não faz nada e não lança", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await syncBookIndex([book.id], catalogIntegration, null)).toEqual({ indexed: 0 });
});

test("UC24: um embedder de outra dimensão refaz a tabela e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const other = createHashEmbedder(512);
  try {
    await syncBookIndex([book.id], catalogIntegration, other);
    expect((await stored(book.id))!.dims).toBe(512);
    const [column] = await sql`SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'livros_vetores'::regclass AND attname = 'embedding'`;
    expect(column!.type).toBe("vector(512)");
    // a tabela nova estava vazia: a reconciliação em segundo plano indexa os outros livros também
    for (let i = 0; i < 200; i++) {
      const [row] = await sql`SELECT COUNT(*)::int AS missing FROM livros l LEFT JOIN livros_vetores v ON v.livro_id = l.id WHERE v.livro_id IS NULL` as { missing: number }[];
      if (row!.missing === 0) break;
      await Bun.sleep(25);
    }
  } finally {
    // os outros testes compartilham o banco: devolve a tabela de 1024 dimensões e espera terminar
    await syncBookIndex([book.id], catalogIntegration, base);
    await reconcileBookIndex(catalogIntegration, base);
  }
  expect(await stored(book.id)).toEqual({ texto: expect.any(String), dims: base.dimensions } as Stored);
});
