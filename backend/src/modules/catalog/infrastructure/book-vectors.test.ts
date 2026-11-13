import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookIndex";

// Consulta os dados do vetor diretamente na tabela livros_vetores do Postgres
async function getStoredVector(id: number): Promise<{ texto: string; modelo: string; dims: number } | null> {
  const [row] = await sql`
    SELECT texto, modelo, vector_dims(v) AS dims
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

test("UC24: cadastrar livro grava texto 'Título — Autor' e vetor com dimensão correta", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const stored = await getStoredVector(book.id);
  expect(stored).not.toBeNull();
  expect(stored!.texto).toBe(`${title} — ${author.nome}`);
  expect(stored!.dims).toBe(1024); // hashEmbedder padrão tem 1024 dimensões
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newTitle = `Novo título ${crypto.randomUUID().slice(0, 8)}`;

  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: newTitle, autorId: author.id })).status).toBe(200);

  const stored = await getStoredVector(book.id);
  expect(stored).not.toBeNull();
  expect(stored!.texto).toBe(`${newTitle} — ${author.nome}`);
});

test("UC24: excluir o livro remove a linha de vetor via CASCADE", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);

  expect(await getStoredVector(book.id)).not.toBeNull();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await getStoredVector(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newAuthorName = `Autora ${crypto.randomUUID().slice(0, 8)}`;

  expect((await api("PUT", `/autores/${author.id}`, { nome: newAuthorName, tipo: "literatura" })).status).toBe(200);

  const stored = await getStoredVector(book.id);
  expect(stored).not.toBeNull();
  expect(stored!.texto).toEndWith(`— ${newAuthorName}`);
});

test("UC24: livro inserido direto com SQL ganha vetor após reconciliação", async () => {
  const author = await testAuthor();
  const title = `Livro Direto ${crypto.randomUUID().slice(0, 8)}`;
  const isbn = testIsbn();
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${isbn}, ${title}, ${author.id}, '2026-01-01')
    RETURNING id
  ` as { id: number }[];

  // Antes da reconciliação, o livro não tem vetor
  expect(await getStoredVector(inserted!.id)).toBeNull();

  // Executa reconciliação
  await reconcileBookIndex(catalogIntegration);

  const stored = await getStoredVector(inserted!.id);
  expect(stored).not.toBeNull();
  expect(stored!.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar livro com texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const title = `Livro Cache ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  let embedCalls = 0;
  const base = createHashEmbedder();
  const countingEmbedder: Embedder = {
    ...base,
    embed: (texts, usage) => {
      embedCalls++;
      return base.embed(texts, usage);
    },
  };

  // Primeira sincronização com texto inalterado: deve pular o embedder
  const result = await syncBookIndex([book.id], catalogIntegration, countingEmbedder);
  expect(result.indexed).toBe(0);
  expect(embedCalls).toBe(0);
});

test("UC24: tolerância a falhas do embedder (não derruba e não lança)", async () => {
  const author = await testAuthor();
  const title = `Livro Falha ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  const base = createHashEmbedder();
  const failingEmbedder: Embedder = {
    ...base,
    embed: async () => {
      throw new Error("Serviço de embedding indisponível");
    },
  };

  // syncBookIndex não deve lançar exceção
  const result = await syncBookIndex([book.id], catalogIntegration, failingEmbedder);
  expect(result).toEqual({ indexed: 0, removed: 0 });
});

test("UC24: troca de modelo ou dimensão refaz a tabela e reindexa", async () => {
  const author = await testAuthor();
  const title = `Livro Dimensão ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);

  // Inicialmente tem 1024 dimensões
  expect((await getStoredVector(book.id))?.dims).toBe(1024);

  // Troca para embedder de 512 dimensões
  const embedder512 = createHashEmbedder(512);
  const result512 = await syncBookIndex([book.id], catalogIntegration, embedder512);
  expect(result512.indexed).toBeGreaterThanOrEqual(1);

  // Confere que a dimensão mudou no Postgres
  const stored512 = await getStoredVector(book.id);
  expect(stored512?.dims).toBe(512);

  // Restaura o embedder padrão (1024) para isolar este teste dos demais da suíte (Armadilha 4)
  const defaultEmbedder = createHashEmbedder(1024);
  await reconcileBookIndex(catalogIntegration, defaultEmbedder);
  const restored = await getStoredVector(book.id);
  expect(restored?.dims).toBe(1024);
});
