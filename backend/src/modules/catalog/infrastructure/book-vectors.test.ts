
import { expect, test } from "bun:test";
import { api, testBook, testIsbn, testName } from "#tests/api";
import { sql } from "../../../infrastructure/postgres";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import type { Embedder } from "../../../shared/Embedder";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import {
  ensureBookVectors,
  reconcileBookVectors,
  syncBookVectors,
} from "./bookVectors";

async function vectorText(id: number): Promise<string | null> {
  const [row] = await sql`
    SELECT texto
    FROM livros_vetores
    WHERE livro_id = ${id}
  ` as { texto: string }[];

  return row?.texto ?? null;
}

function trackingEmbedder() {
  const base = createHashEmbedder();
  let calls = 0;

  const embedder: Embedder = {
    ...base,
    async embed(texts, purpose) {
      calls += texts.length;
      return base.embed(texts, purpose);
    },
  };

  return {
    embedder,
    calls: () => calls,
  };
}

test("cria vetor automaticamente ao cadastrar livro", async () => {
  const book = await testBook();

  const text = await vectorText(book.id);

  expect(text).toContain(book.titulo);
  expect(text).not.toBeNull();
});

test("atualiza o texto vetorial ao editar livro", async () => {
  const book = await testBook();
  const titulo = testName("Título atualizado");

  const response = await api("PUT", `/livros/${book.id}`, {
    isbn: testIsbn(),
    titulo,
    autorId: book.autorId,
  });

  expect(response.status).toBe(200);
  expect(await vectorText(book.id)).toContain(titulo);
});

test("remove o vetor ao excluir livro", async () => {
  const book = await testBook();

  expect(await vectorText(book.id)).not.toBeNull();

  const response = await api("DELETE", `/livros/${book.id}`);

  expect(response.status).toBe(204);
  expect(await vectorText(book.id)).toBeNull();
});

test("reindexa livros quando o nome do autor muda", async () => {
  const book = await testBook();
  const nome = testName("Autor renomeado");

  const response = await api("PUT", `/autores/${book.autorId}`, {
    nome,
    tipo: "literatura",
  });

  expect(response.status).toBe(200);
  expect(await vectorText(book.id)).toContain(nome);
});

test("reconcilia vetores que estão ausentes", async () => {
  const book = await testBook();

  await sql`
    DELETE FROM livros_vetores
    WHERE livro_id = ${book.id}
  `;

  expect(await vectorText(book.id)).toBeNull();

  await reconcileBookVectors(
    catalogIntegration,
    createHashEmbedder(),
  );

  expect(await vectorText(book.id)).not.toBeNull();
});

test("não gera novo embedding quando o texto não mudou", async () => {
  const book = await testBook();
  const tracker = trackingEmbedder();

  const result = await syncBookVectors(
    [book.id],
    catalogIntegration,
    tracker.embedder,
  );

  expect(result.indexed).toBe(0);
  expect(tracker.calls()).toBe(0);
});

test("falha no embedding não propaga erro nem apaga livro cadastrado", async () => {
  const book = await testBook();

  await sql`
    DELETE FROM livros_vetores
    WHERE livro_id = ${book.id}
  `;

  const failingEmbedder: Embedder = {
    id: "hash-1024",
    dimensions: 1024,
    maxDistance: 0.6,
    async embed() {
      throw new Error("Falha simulada no embedding");
    },
  };

  const result = await syncBookVectors(
    [book.id],
    catalogIntegration,
    failingEmbedder,
  );

  expect(result.indexed).toBe(0);

  const [row] = await sql`
    SELECT id FROM livros WHERE id = ${book.id}
  ` as { id: number }[];

  expect(row).toBeDefined();
});

test("recria tabela quando a dimensão do modelo muda e restaura hash-1024", async () => {
  const originalEmbedder = createHashEmbedder(1024);
  const alternateEmbedder = createHashEmbedder(16);

  try {
    expect(await ensureBookVectors(originalEmbedder)).toBe(false);

    expect(await ensureBookVectors(alternateEmbedder)).toBe(true);

    const [dimension] = await sql`
      SELECT format_type(atttypid, atttypmod) AS type
      FROM pg_attribute
      WHERE attrelid = 'public.livros_vetores'::regclass
        AND attname = 'embedding'
    ` as { type: string }[];

    if (!dimension) {
      throw new Error("Coluna embedding não encontrada");
    }

    expect(dimension.type).toBe("vector(16)");
  } finally {
    await ensureBookVectors(originalEmbedder);

    await reconcileBookVectors(
      catalogIntegration,
      originalEmbedder,
    );
  }
});
