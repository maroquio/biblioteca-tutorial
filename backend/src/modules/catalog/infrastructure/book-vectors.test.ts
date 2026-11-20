import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookVectors, syncBookVectors } from "./bookVectors";

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

test("UC24: cadastrar livro grava texto e vetor com dimensões do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);
  const [row] = await sql`
    SELECT texto, vector_dims(embedding) AS dims
    FROM livros_vetores
    WHERE livro_id = ${book.id}
  ` as { texto: string; dims: number }[];
  expect(row?.texto).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(createHashEmbedder().dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const [before] = await sql`SELECT embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}` as { v: string }[];
  const title = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const [after] = await sql`SELECT texto, embedding::text AS v FROM livros_vetores WHERE livro_id = ${book.id}` as { texto: string; v: string }[];
  expect(after?.texto).toBe(`${title} — ${author.nome}`);
  expect(after?.v).not.toBe(before?.v);
});

test("UC24: excluir o livro remove a linha da tabela de vetores", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const [foundBefore] = await sql`SELECT 1 FROM livros_vetores WHERE livro_id = ${book.id}`;
  expect(foundBefore).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  const [foundAfter] = await sql`SELECT 1 FROM livros_vetores WHERE livro_id = ${book.id}`;
  expect(foundAfter).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  const [row] = await sql`SELECT texto FROM livros_vetores WHERE livro_id = ${book.id}` as { texto: string }[];
  expect(row?.texto).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL ganha vetor após reconciliação", async () => {
  const author = await testAuthor();
  const title = `Direto no SQL ${crypto.randomUUID().slice(0, 8)}`;
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-11-12')
    RETURNING id
  ` as { id: number }[];

  const [before] = await sql`SELECT 1 FROM livros_vetores WHERE livro_id = ${inserted!.id}`;
  expect(before).toBeUndefined();

  await reconcileBookVectors(catalogIntegration);

  const [after] = await sql`SELECT texto FROM livros_vetores WHERE livro_id = ${inserted!.id}` as { texto: string }[];
  expect(after?.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar livro com texto inalterado não chama o embedder", async () => {
  const author = await testAuthor();
  const title = `Livro Cache ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const base = createHashEmbedder();
  let calls = 0;
  const countingEmbedder: Embedder = {
    ...base,
    embed: (texts, purpose) => {
      calls++;
      return base.embed(texts, purpose);
    },
  };

  const result = await syncBookVectors([book.id], catalogIntegration, countingEmbedder);
  expect(calls).toBe(0);
  expect(result.indexed).toBe(0);
});

test("UC24: com embedder que falha a sincronização não lança e o cadastro não falha", async () => {
  const author = await testAuthor();
  const title = `Livro Sem Vetor ${crypto.randomUUID().slice(0, 8)}`;
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-11-12')
    RETURNING id
  ` as { id: number }[];

  const base = createHashEmbedder();
  const failingEmbedder: Embedder = {
    ...base,
    embed: async () => {
      throw new Error("Gemini temporariamente fora do ar");
    },
  };

  // Sincronização falha silenciosamente sem lançar exceção
  const result = await syncBookVectors([inserted!.id], catalogIntegration, failingEmbedder);
  expect(result).toEqual({ indexed: 0, removed: 0 });

  // O cadastro do livro no banco continua intacto
  const [bookRow] = await sql`SELECT id FROM livros WHERE id = ${inserted!.id}`;
  expect(bookRow).toBeDefined();
});

test("UC24: embedder de outra dimensão refaz a tabela e reindexa os livros", async () => {
  const author = await testAuthor();
  const title = `Livro Redim ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const embedder512 = createHashEmbedder(512);
  try {
    const result = await syncBookVectors([book.id], catalogIntegration, embedder512);
    expect(result.indexed).toBe(1);

    const [row] = await sql`
      SELECT vector_dims(embedding) AS dims
      FROM livros_vetores
      WHERE livro_id = ${book.id}
    ` as { dims: number }[];
    expect(row?.dims).toBe(512);
  } finally {
    // Restaura o embedder padrão de 1024 dimensões para não afetar outros testes
    const baseEmbedder = createHashEmbedder(1024);
    await reconcileBookVectors(catalogIntegration, baseEmbedder);
  }
});
