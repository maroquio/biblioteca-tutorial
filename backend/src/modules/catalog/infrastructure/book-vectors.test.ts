import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

async function getVectorRow(livroId: number): Promise<{ texto: string; dims: number } | null> {
  const rows = await sql`
    SELECT texto, vector_dims(v) AS dims
    FROM livros_vetores
    WHERE livro_id = ${livroId}
  ` as { texto: string; dims: number }[];
  return rows[0] ?? null;
}

test("UC24: livro cadastrado grava linha com texto e vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);
  const row = await getVectorRow(book.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
  expect(row!.dims).toBe(1024);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const title = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const row = await getVectorRow(book.id);
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: excluir o livro remove a linha", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  expect(await getVectorRow(book.id)).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await getVectorRow(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const name = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  const row = await getVectorRow(book.id);
  expect(row!.texto).toEndWith(`— ${name}`);
});

test("UC24: livro inserido direto com SQL ganha vetor após reconciliação", async () => {
  const author = await testAuthor();
  const isbn = testIsbn();
  const title = `Direto SQL ${crypto.randomUUID().slice(0, 8)}`;
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${isbn}, ${title}, ${author.id}, '2026-11-10')
    RETURNING id
  ` as { id: number }[];
  expect(await getVectorRow(inserted!.id)).toBeNull();
  await reconcileBookIndex(catalogIntegration);
  const row = await getVectorRow(inserted!.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar de novo com texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const base = createHashEmbedder();
  let calls = 0;
  const countingEmbedder: Embedder = {
    ...base,
    embed: (texts, usage) => {
      calls++;
      return base.embed(texts, usage);
    },
  };
  const result = await syncBookIndex([book.id], catalogIntegration, countingEmbedder);
  expect(result).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);
});

test("UC24: com embedder que falha, a sincronização não lança e o cadastro do livro não falha", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const base = createHashEmbedder();
  const failingEmbedder: Embedder = {
    ...base,
    embed: async () => {
      throw new Error("Gemini indisponível");
    },
  };
  const result = await syncBookIndex([book.id], catalogIntegration, failingEmbedder);
  expect(result).toEqual({ indexed: 0, removed: 0 });
});

test("UC24: embedder de outra dimensão refaz a tabela e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro 512 ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const embedder512 = createHashEmbedder(512);

  await syncBookIndex([book.id], catalogIntegration, embedder512);
  const row512 = await getVectorRow(book.id);
  expect(row512!.dims).toBe(512);

  // Armadilha 4: devolve o banco ao estado do embedder padrão de 1024 dimensões
  const defaultEmbedder = createHashEmbedder(1024);
  await reconcileBookIndex(catalogIntegration, defaultEmbedder);
  const rowRestored = await getVectorRow(book.id);
  expect(rowRestored!.dims).toBe(1024);
});
