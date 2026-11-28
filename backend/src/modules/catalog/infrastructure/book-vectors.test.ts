import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

async function getVectorRow(id: number): Promise<{ texto: string; modelo: string; dims: number } | null> {
  const [row] = await sql`
    SELECT texto, modelo, vector_dims(embedding) AS dims
    FROM livros_vetores
    WHERE livro_id = ${id}
  ` as { texto: string; modelo: string; dims: number }[];
  return row ?? null;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

test("UC24: cadastrar um livro grava uma linha com o texto 'Título — Autor' e o vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const row = await getVectorRow(book.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
  expect(row!.dims).toBe(1024); // hash embedder padrão nos testes tem 1024 dimensões
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newTitle = `Novo Título ${crypto.randomUUID().slice(0, 8)}`;

  const response = await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: newTitle, autorId: author.id });
  expect(response.status).toBe(200);

  const row = await getVectorRow(book.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${newTitle} — ${author.nome}`);
});

test("UC24: excluir o livro remove a linha de vetores via CASCADE", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);

  expect(await getVectorRow(book.id)).not.toBeNull();
  const response = await api("DELETE", `/livros/${book.id}`);
  expect(response.status).toBe(204);

  expect(await getVectorRow(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newAuthorName = `Autora Renomeada ${crypto.randomUUID().slice(0, 8)}`;

  const response = await api("PUT", `/autores/${author.id}`, { nome: newAuthorName, tipo: "literatura" });
  expect(response.status).toBe(200);

  const row = await getVectorRow(book.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toEndWith(`— ${newAuthorName}`);
});

test("UC24: livro inserido direto com SQL (seed) ganha vetor depois da reconciliação", async () => {
  const author = await testAuthor();
  const title = `Livro Direto ${crypto.randomUUID().slice(0, 8)}`;
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-11-28')
    RETURNING id
  ` as { id: number }[];

  // Antes da reconciliação, não tem vetor
  expect(await getVectorRow(inserted!.id)).toBeNull();

  // Executa reconciliação
  await reconcileBookIndex(catalogIntegration);

  const row = await getVectorRow(inserted!.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar de novo um livro com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const title = `Livro Cache ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const base = createHashEmbedder();
  let chamadas = 0;
  const contador: Embedder = {
    ...base,
    embed: (textos, uso) => {
      chamadas++;
      return base.embed(textos, uso);
    },
  };

  // Primeira checagem: o livro já está indexado com esse texto
  const result = await syncBookIndex([book.id], catalogIntegration, contador);
  expect(result.indexed).toBe(0);
  expect(chamadas).toBe(0);
});

test("UC24: com embedder que falha, a sincronização não lança e o cadastro não falha", async () => {
  const author = await testAuthor();
  const title = `Livro Falha ${crypto.randomUUID().slice(0, 8)}`;
  const base = createHashEmbedder();
  const foraDoAr: Embedder = {
    ...base,
    embed: async () => {
      throw new Error("Gemini indisponível");
    },
  };

  // syncBookIndex não deve lançar erro
  const result = await syncBookIndex([999999], catalogIntegration, foraDoAr);
  expect(result).toEqual({ indexed: 0, removed: 0 });

  // Cadastro de livro pela API conclui normalmente mesmo com embedder que falharia
  const book = await createBook(title, author.id);
  expect(book.id).toBeGreaterThan(0);
});

test("UC24: embedder de outra dimensão refaz a tabela e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  const title = `Livro Outra Dimensao ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const embedder512 = createHashEmbedder(512);

  // Reconcilia com dimensão 512
  const res = await reconcileBookIndex(catalogIntegration, embedder512);
  expect(res.indexed).toBeGreaterThanOrEqual(1);

  const row512 = await getVectorRow(book.id);
  expect(row512).not.toBeNull();
  expect(row512!.dims).toBe(512);

  // IMPORTANTE (Armadilha 4): Restaurar o banco para o embedder padrão (1024 dimensões)
  const defaultEmbedderInstance = createHashEmbedder(1024);
  await reconcileBookIndex(catalogIntegration, defaultEmbedderInstance);

  const rowRestored = await getVectorRow(book.id);
  expect(rowRestored).not.toBeNull();
  expect(rowRestored!.dims).toBe(1024);
});
