import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookVectors, syncBookVectors } from "./bookVectors";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro gera vetor de verdade, sem rede
type Stored = { texto: string; dims: number } | undefined;

async function stored(id: number): Promise<Stored> {
  const [row] = await sql`SELECT texto, vector_dims(embedding) AS dims FROM livros_vetores WHERE livro_id = ${id}` as NonNullable<Stored>[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

const name = (prefix: string) => `${prefix} ${crypto.randomUUID().slice(0, 8)}`;
const base = createHashEmbedder();

test("UC24: livro cadastrado ganha vetor com título e autor", async () => {
  const author = await testAuthor();
  const title = name("Livro");
  const book = await createBook(title, author.id);
  expect(await stored(book.id)).toEqual({ texto: `${title} — ${author.nome}`, dims: base.dimensions });
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(name("Livro"), author.id);
  const [before] = await sql`SELECT embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}` as { v: string }[];
  const title = name("Novo título");
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  expect((await stored(book.id))?.texto).toBe(`${title} — ${author.nome}`);
  const [after] = await sql`SELECT embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}` as { v: string }[];
  expect(after!.v).not.toBe(before!.v);
});

test("UC24: excluir o livro remove a linha", async () => {
  const author = await testAuthor();
  const book = await createBook(name("Livro"), author.id);
  expect(await stored(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await stored(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(name("Livro"), author.id);
  const newName = name("Autora");
  expect((await api("PUT", `/autores/${author.id}`, { nome: newName, tipo: "literatura" })).status).toBe(200);
  expect((await stored(book.id))?.texto).toEndWith(`— ${newName}`);
});

test("UC24: livro inserido direto com SQL ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const [row] = await sql`INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao) VALUES (${testIsbn()}, ${name("Via seed")}, ${author.id}, '2026-01-01') RETURNING id` as { id: number }[];
  expect(await stored(row!.id)).toBeUndefined();
  await reconcileBookVectors(catalogIntegration, base);
  expect((await stored(row!.id))?.dims).toBe(base.dimensions);
});

test("UC24: texto igual não chama o embedder de novo", async () => {
  const author = await testAuthor();
  const book = await createBook(name("Livro"), author.id);
  let calls = 0;
  // mesmo id e mesma dimensão: o ensure não pode achar que o modelo mudou
  const counter: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };
  expect(await syncBookVectors([book.id], catalogIntegration, counter)).toEqual({ indexed: 0 });
  expect(calls).toBe(0);
});

test("UC24: embedder que falha não lança e não derruba o cadastro", async () => {
  const author = await testAuthor();
  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  const [row] = await sql`INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao) VALUES (${testIsbn()}, ${name("Sem vetor")}, ${author.id}, '2026-01-01') RETURNING id` as { id: number }[];
  expect(await syncBookVectors([row!.id], catalogIntegration, down)).toEqual({ indexed: 0 });
  expect(await stored(row!.id)).toBeUndefined();
  // a escrita pela API segue funcionando mesmo que o vetor falhe depois do COMMIT
  expect((await createBook(name("Livro"), author.id)).id).toBeGreaterThan(0);
});

test("UC24: embedder de outra dimensão refaz a tabela", async () => {
  const author = await testAuthor();
  const book = await createBook(name("Livro"), author.id);
  try {
    expect(await syncBookVectors([book.id], catalogIntegration, createHashEmbedder(512))).toEqual({ indexed: 1 });
    expect((await stored(book.id))?.dims).toBe(512);
    // só este livro foi reindexado de imediato; os outros voltam pela reconciliação
    await reconcileBookVectors(catalogIntegration, createHashEmbedder(512));
    const [count] = await sql`SELECT (SELECT COUNT(*)::int FROM livros) AS livros, (SELECT COUNT(*)::int FROM livros_vetores) AS vetores` as { livros: number; vetores: number }[];
    expect(count!.vetores).toBe(count!.livros);
  } finally {
    // os outros testes compartilham o banco: devolve a tabela de 1024 dimensões e espera terminar
    await syncBookVectors([book.id], catalogIntegration, base);
    await reconcileBookVectors(catalogIntegration, base);
  }
  expect((await stored(book.id))?.dims).toBe(base.dimensions);
});

test("UC24: a tabela tem chave estrangeira com CASCADE e índice HNSW de cosseno", async () => {
  const [fk] = await sql`SELECT confdeltype AS tipo FROM pg_constraint WHERE conrelid = 'livros_vetores'::regclass AND contype = 'f'` as { tipo: string }[];
  expect(fk!.tipo).toBe("c");
  const [idx] = await sql`SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexdef ILIKE '%hnsw%'` as { indexdef: string }[];
  expect(idx!.indexdef).toContain("vector_cosine_ops");
});
