import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro indexa de verdade, sem rede
const base = createHashEmbedder();

type Stored = { texto: string; modelo: string; dims: number };

async function stored(bookId: number): Promise<Stored | null> {
  const [row] = await sql`SELECT texto, modelo, vector_dims(embedding) AS dims FROM livros_vetores WHERE livro_id = ${bookId}` as Stored[];
  return row ?? null;
}

async function columnType(): Promise<string | null> {
  const [row] = await sql`
    SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'embedding'
  ` as { type: string }[];
  return row?.type ?? null;
}

function title(): string {
  return `Livro ${crypto.randomUUID().slice(0, 8)}`;
}

async function createBook(bookTitle: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: bookTitle, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

/** Como o seed faz: escreve direto em livros, sem passar pela fatia create-book. */
async function insertBookWithSql(bookTitle: string, authorId: number): Promise<number> {
  const [row] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${bookTitle}, ${authorId}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  return row!.id;
}

test("UC24: livro cadastrado ganha uma linha com título, autor e vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const bookTitle = title();
  const book = await createBook(bookTitle, author.id);
  expect(await stored(book.id)).toEqual({ texto: `${bookTitle} — ${author.nome}`, modelo: base.id, dims: base.dimensions });
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const [before] = await sql`SELECT embedding::text AS vetor FROM livros_vetores WHERE livro_id = ${book.id}` as { vetor: string }[];
  const newTitle = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: newTitle, autorId: author.id })).status).toBe(200);
  expect((await stored(book.id))!.texto).toBe(`${newTitle} — ${author.nome}`);
  const [after] = await sql`SELECT embedding::text AS vetor FROM livros_vetores WHERE livro_id = ${book.id}` as { vetor: string }[];
  expect(after!.vetor).not.toBe(before!.vetor);
});

test("UC24: excluir o livro remove a linha (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await stored(book.id)).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await stored(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await stored(book.id))!.texto).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const bookTitle = title();
  const id = await insertBookWithSql(bookTitle, author.id);
  expect(await stored(id)).toBeNull();
  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThanOrEqual(1);
  expect(await stored(id)).toEqual({ texto: `${bookTitle} — ${author.nome}`, modelo: base.id, dims: base.dimensions });
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  // mesmo id e mesma dimensão do padrão, mas conta as chamadas
  let calls = 0;
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookIndex([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
});

test("UC24: com o embedder fora do ar a sincronização não lança e o livro fica para a reconciliação", async () => {
  const author = await testAuthor();
  const id = await insertBookWithSql(title(), author.id);
  // mesmo id e mesma dimensão do padrão (senão a tabela seria recriada), mas o embed sempre falha
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([id], catalogIntegration, down)).toEqual({ indexed: 0 });
  expect(await stored(id)).toBeNull();
  // quando o embedder volta, a mesma sincronização resolve
  expect(await syncBookIndex([id], catalogIntegration, base)).toEqual({ indexed: 1 });
  expect(await stored(id)).not.toBeNull();
});

test("UC24: a tabela é do Acervo, com chave estrangeira em cascata e índice HNSW de distância cosseno", async () => {
  await createBook(title(), (await testAuthor()).id);
  const [fk] = await sql`
    SELECT confdeltype AS "onDelete", confrelid::regclass::text AS target
    FROM pg_constraint WHERE conrelid = to_regclass('livros_vetores') AND contype = 'f'
  ` as { onDelete: string; target: string }[];
  expect(fk).toEqual({ onDelete: "c", target: "livros" }); // "c" = CASCADE
  const [index] = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexdef ILIKE '%hnsw%'` as { indexdef: string }[];
  expect(index!.indexdef).toContain("vector_cosine_ops");
});

test("UC24: embedder de outra dimensão refaz a tabela e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(title(), author.id);
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  const small = createHashEmbedder(512);
  try {
    // a reconciliação é esperada (await): quando ela volta, a tabela nova já tem todos os livros
    await reconcileBookIndex(catalogIntegration, small);
    expect(await columnType()).toBe("vector(512)");
    expect(await stored(book.id)).toMatchObject({ modelo: small.id, dims: 512 });
    const [missing] = await sql`
      SELECT COUNT(*)::int AS total FROM livros l
      LEFT JOIN livros_vetores v ON v.livro_id = l.id WHERE v.livro_id IS NULL
    ` as { total: number }[];
    expect(missing!.total).toBe(0);
  } finally {
    // os outros testes dividem este banco: devolve a tabela ao embedder padrão antes de sair
    await reconcileBookIndex(catalogIntegration, base);
  }
  expect(await columnType()).toBe(`vector(${base.dimensions})`);
  expect(await stored(book.id)).toMatchObject({ modelo: base.id, dims: base.dimensions });
});
