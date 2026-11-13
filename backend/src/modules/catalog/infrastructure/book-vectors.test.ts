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

test("UC24: cadastrar livro grava texto e vetor da dimensao do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${crypto.randomUUID().slice(0, 8)}`;
  const book = await createBook(title, author.id);
  const [row] = await sql`
    SELECT texto, vector_dims(v) AS dims
    FROM livros_vetores
    WHERE livro_id = ${book.id}
  ` as { texto: string; dims: number }[];
  expect(row).toBeDefined();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
  expect(row!.dims).toBe(1024);
});

test("UC24: editar o titulo atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const [initial] = await sql`
    SELECT v::text AS vector_str
    FROM livros_vetores
    WHERE livro_id = ${book.id}
  ` as { vector_str: string }[];
  const newTitle = `Novo Titulo ${crypto.randomUUID().slice(0, 8)}`;
  const response = await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: newTitle, autorId: author.id });
  expect(response.status).toBe(200);
  const [updated] = await sql`
    SELECT texto, v::text AS vector_str
    FROM livros_vetores
    WHERE livro_id = ${book.id}
  ` as { texto: string; vector_str: string }[];
  expect(updated!.texto).toBe(`${newTitle} — ${author.nome}`);
  expect(updated!.vector_str).not.toBe(initial!.vector_str);
});

test("UC24: excluir o livro remove a linha", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const [before] = await sql`SELECT 1 FROM livros_vetores WHERE livro_id = ${book.id}`;
  expect(before).toBeDefined();
  const response = await api("DELETE", `/livros/${book.id}`);
  expect(response.status).toBe(204);
  const after = await sql`SELECT 1 FROM livros_vetores WHERE livro_id = ${book.id}`;
  expect(after.length).toBe(0);
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const newName = `Autora ${crypto.randomUUID().slice(0, 8)}`;
  const response = await api("PUT", `/autores/${author.id}`, { nome: newName, tipo: "literatura" });
  expect(response.status).toBe(200);
  const [row] = await sql`
    SELECT texto
    FROM livros_vetores
    WHERE livro_id = ${book.id}
  ` as { texto: string }[];
  expect(row!.texto).toEndWith(`— ${newName}`);
});

test("UC24: livro inserido direto no sql ganha vetor apos reconciliacao", async () => {
  const author = await testAuthor();
  const title = `Direto SQL ${crypto.randomUUID().slice(0, 8)}`;
  const isbn = testIsbn();
  const [inserted] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${isbn}, ${title}, ${author.id}, '2026-11-12')
    RETURNING id
  ` as { id: number }[];
  await sql`DELETE FROM livros_vetores WHERE livro_id = ${inserted!.id}`;
  await reconcileBookVectors(catalogIntegration);
  const [row] = await sql`
    SELECT texto, vector_dims(v) AS dims
    FROM livros_vetores
    WHERE livro_id = ${inserted!.id}
  ` as { texto: string; dims: number }[];
  expect(row).toBeDefined();
  expect(row!.texto).toBe(`${title} — ${author.nome}`);
  expect(row!.dims).toBe(1024);
});

test("UC24: sincronizar livro com texto igual nao chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const base = createHashEmbedder();
  let calls = 0;
  const counter: Embedder = {
    ...base,
    embed: (texts, usage) => {
      calls++;
      return base.embed(texts, usage);
    },
  };
  const result = await syncBookVectors([book.id], catalogIntegration, counter);
  expect(result.indexed).toBe(0);
  expect(calls).toBe(0);
});

test("UC24: com embedder que falha a sincronizacao nao lanca e o cadastro nao falha", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const base = createHashEmbedder();
  const failing: Embedder = {
    ...base,
    embed: async () => {
      throw new Error("falha simulada do embedder");
    },
  };
  const result = await syncBookVectors([book.id], catalogIntegration, failing);
  expect(result).toEqual({ indexed: 0, removed: 0 });
});

test("UC24: embedder de outra dimensao refaz a tabela e os livros voltam a ter vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${crypto.randomUUID().slice(0, 8)}`, author.id);
  const embedder512 = createHashEmbedder(512);
  await reconcileBookVectors(catalogIntegration, embedder512);
  const [row512] = await sql`
    SELECT vector_dims(v) AS dims
    FROM livros_vetores
    WHERE livro_id = ${book.id}
  ` as { dims: number }[];
  expect(row512?.dims).toBe(512);

  const defaultBase = createHashEmbedder();
  await reconcileBookVectors(catalogIntegration, defaultBase);
  const [rowDefault] = await sql`
    SELECT vector_dims(v) AS dims
    FROM livros_vetores
    WHERE livro_id = ${book.id}
  ` as { dims: number }[];
  expect(rowDefault?.dims).toBe(1024);
}, 15000);
