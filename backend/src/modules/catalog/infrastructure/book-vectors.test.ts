import { expect, test } from "bun:test";
import { api, testAuthor, testIsbn } from "#tests/api";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookIndex";

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

async function vectorRow(bookId: number): Promise<{ texto: string; dims: number } | null> {
  const [row] = await sql`
    SELECT texto, vector_dims(v) AS dims
    FROM livros_vetores
    WHERE livro_id = ${bookId}
  ` as { texto: string; dims: number }[];
  return row ?? null;
}

test("UC24: cadastrar livro grava texto 'Título — Autor' e vetor com dimensões do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);
  const row = await vectorRow(book.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
  expect(row!.dims).toBe(1024);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newTitle = `Novo título ${crypto.randomUUID().slice(0, 8)}`;
  const res = await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: newTitle, autorId: author.id });
  expect(res.status).toBe(200);
  const row = await vectorRow(book.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${newTitle} — ${author.nome}`);
});

test("UC24: excluir o livro remove a linha de vetores", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  expect(await vectorRow(book.id)).not.toBeNull();
  const res = await api("DELETE", `/livros/${book.id}`);
  expect(res.status).toBe(204);
  expect(await vectorRow(book.id)).toBeNull();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newName = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  const res = await api("PUT", `/autores/${author.id}`, { nome: newName, tipo: "literatura" });
  expect(res.status).toBe(200);
  const row = await vectorRow(book.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toEndWith(`— ${newName}`);
});

test("UC24: livro inserido direto com SQL ganha vetor após reconciliação", async () => {
  const author = await testAuthor();
  const title = `Direto SQL ${crypto.randomUUID().slice(0, 8)}`;
  const isbn = testIsbn();
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${isbn}, ${title}, ${author.id}, '2026-11-09')
    RETURNING id
  ` as { id: number }[];
  expect(await vectorRow(inserted!.id)).toBeNull();
  await reconcileBookIndex(catalogIntegration);
  const row = await vectorRow(inserted!.id);
  expect(row).not.toBeNull();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: sincronizar de novo livro com texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  expect(await vectorRow(book.id)).not.toBeNull();

  const base = createHashEmbedder();
  let chamadas = 0;
  const contador: Embedder = {
    ...base,
    embed: (textos, uso) => {
      chamadas++;
      return base.embed(textos, uso);
    },
  };

  const res = await syncBookIndex([book.id], catalogIntegration, contador);
  expect(chamadas).toBe(0);
  expect(res.indexed).toBe(0);
});

test("UC24: com embedder que falha a sincronização não lança", async () => {
  const author = await testAuthor();
  const base = createHashEmbedder();
  const foraDoAr: Embedder = {
    ...base,
    embed: async () => {
      throw new Error("fora do ar");
    },
  };

  const book = await createBook(`Livro resiliente ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const res = await syncBookIndex([book.id], catalogIntegration, foraDoAr);
  expect(res).toEqual({ indexed: 0, removed: 0 });
});

test("UC24: embedder de outra dimensão refaz a tabela e reindexa os livros", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro Multi-Dim ${crypto.randomUUID().slice(0, 8)}`, author.id);

  try {
    const embedder512 = createHashEmbedder(512);
    const result = await syncBookIndex([book.id], catalogIntegration, embedder512);
    expect(result.indexed).toBeGreaterThanOrEqual(1);

    const [tipo] = await sql`
      SELECT format_type(atttypid, atttypmod) AS tipo
      FROM pg_attribute
      WHERE attrelid = to_regclass('livros_vetores') AND attname = 'v'
    ` as { tipo: string }[];
    expect(tipo!.tipo).toBe("vector(512)");

    const row = await vectorRow(book.id);
    expect(row).not.toBeNull();
    expect(row!.dims).toBe(512);
  } finally {
    await Bun.sleep(50);
    // Restaura o embedder padrão de 1024 dimensões
    const defaultEmbedder = createHashEmbedder(1024);
    await reconcileBookIndex(catalogIntegration, defaultEmbedder);
  }
});
