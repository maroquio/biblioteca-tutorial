import { expect, spyOn, test } from "bun:test";
import { api, testAuthor, testBook, testIsbn, testName } from "#tests/api";
import { embedder } from "../../../infrastructure/embedder";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { reconcileBookIndex, syncBookIndex } from "./bookVectors";

const hash = createHashEmbedder();

async function vectorFor(id: number) {
  const [row] = await sql`
    SELECT texto, vector_dims(embedding) AS dimensoes, embedding::text AS vetor
    FROM acervo_vetores WHERE livro_id = ${id}
  ` as { texto: string; dimensoes: number; vetor: string }[];
  return row;
}

test("UC24: cadastro guarda o vetor de título e autor e a edição substitui o embedding", async () => {
  const author = await testAuthor();
  const title = testName("Viagem de barco");
  const isbn = testIsbn();
  const response = await api("POST", "/livros", { titulo: title, isbn, autorId: author.id });
  expect(response.status).toBe(201);
  const { id } = await response.json();
  const original = await vectorFor(id);
  expect(original).toMatchObject({ texto: `${title} — ${author.nome}`, dimensoes: hash.dimensions });

  const nextTitle = testName("Culinária");
  expect((await api("PUT", `/livros/${id}`, { titulo: nextTitle, isbn, autorId: author.id })).status).toBe(200);
  const updated = await vectorFor(id);
  const text = `${nextTitle} — ${author.nome}`;
  const [expected] = await hash.embed([text], "document");
  expect(updated?.texto).toBe(text);
  expect(updated?.vetor).not.toBe(original?.vetor);
  expect(JSON.parse(updated!.vetor)).toEqual(Array.from(expected!));
});

test("UC24: a exclusão do livro remove seu vetor por cascata", async () => {
  const book = await testBook();
  expect(await vectorFor(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await vectorFor(book.id)).toBeUndefined();
});

test("UC24: a mudança do nome do autor reindexa os títulos dele", async () => {
  const author = await testAuthor();
  const books: { id: number; titulo: string }[] = [];
  for (const title of ["Romances do sertão", "Cantos do sertão"]) {
    const response = await api("POST", "/livros", { titulo: title, isbn: testIsbn(), autorId: author.id });
    expect(response.status).toBe(201);
    books.push(await response.json());
  }
  const nome = testName("Autora");
  expect((await api("PUT", `/autores/${author.id}`, { nome, tipo: "literatura" })).status).toBe(200);
  for (const book of books) expect((await vectorFor(book.id))?.texto).toBe(`${book.titulo} — ${nome}`);
});

test("UC24: a reconciliação recupera livros do seed e vetores com o título antigo", async () => {
  const author = await testAuthor();
  const title = testName("Catálogo");
  const [row] = await sql`
    INSERT INTO livros (titulo, isbn, autor_id, data_catalogacao)
    VALUES (${title}, ${testIsbn()}, ${author.id}, '2026-01-15') RETURNING id
  `;
  await reconcileBookIndex(catalogIntegration);
  expect((await vectorFor(row!.id))?.texto).toBe(`${title} — ${author.nome}`);
  const next = testName("Catálogo revisado");
  await sql`UPDATE livros SET titulo = ${next} WHERE id = ${row!.id}`;
  await reconcileBookIndex(catalogIntegration);
  expect((await vectorFor(row!.id))?.texto).toBe(`${next} — ${author.nome}`);
});

test("UC24: sincronizar texto idêntico dispensa uma chamada ao embedder", async () => {
  const book = await testBook();
  const count = spyOn(hash, "embed");
  try {
    await syncBookIndex([book.id], catalogIntegration, hash);
    expect(count).not.toHaveBeenCalled();
  } finally {
    count.mockRestore();
  }
});

test("UC24: o Gemini pode falhar depois do COMMIT e o cadastro ainda responde 201", async () => {
  const author = await testAuthor();
  const isbn = testIsbn();
  const title = testName("Cadastro durante indisponibilidade");
  let committed = false;
  const unavailable = spyOn(embedder!, "embed").mockImplementation(async () => {
    const [row] = await sql`SELECT id FROM livros WHERE isbn = ${isbn}`;
    committed = Boolean(row);
    throw new Error("Provedor indisponível");
  });
  try {
    const response = await api("POST", "/livros", { titulo: title, isbn, autorId: author.id });
    expect(response.status).toBe(201);
    const { id } = await response.json();
    expect(committed).toBe(true);
    expect(await vectorFor(id)).toBeUndefined();
    expect((await syncBookIndex([id], catalogIntegration)).indexed).toBe(0);
    expect((await api("GET", "/busca-semantica/livros?q=romance")).status).toBe(503);
  } finally {
    unavailable.mockRestore();
    await reconcileBookIndex(catalogIntegration);
  }
});

test("UC24: trocar a dimensão ou o modelo reindexa inclusive os demais livros", async () => {
  const first = await testBook();
  const second = await testBook();
  const smaller = createHashEmbedder(512);
  const other: Embedder = { ...smaller, id: "outro-modelo-512" };
  try {
    await syncBookIndex([first.id], catalogIntegration, smaller);
    const [column] = await sql`
      SELECT format_type(atttypid, atttypmod) AS tipo FROM pg_attribute
      WHERE attrelid = 'acervo_vetores'::regclass AND attname = 'embedding'
    `;
    expect(column!.tipo).toBe("vector(512)");
    expect((await vectorFor(second.id))?.dimensoes).toBe(512);
    expect((await reconcileBookIndex(catalogIntegration, other)).indexed).toBeGreaterThanOrEqual(2);
    const [missing] = await sql`
      SELECT count(*)::int AS total FROM livros l
      LEFT JOIN acervo_vetores v ON v.livro_id = l.id WHERE v.livro_id IS NULL
    `;
    expect(missing!.total).toBe(0);
  } finally {
    await reconcileBookIndex(catalogIntegration, hash);
  }
  expect((await vectorFor(first.id))?.dimensoes).toBe(hash.dimensions);
});

test("UC24: uma resposta atrasada do embedder preserva a edição mais recente", async () => {
  const book = await testBook();
  const title = testName("Edição mais recente");
  await sql`DELETE FROM acervo_vetores WHERE livro_id = ${book.id}`;
  const delayed: Embedder = {
    ...hash,
    async embed(texts, purpose) {
      const response = await api("PUT", `/livros/${book.id}`, { titulo: title, isbn: book.isbn, autorId: book.autorId });
      expect(response.status).toBe(200);
      return hash.embed(texts, purpose);
    },
  };
  await syncBookIndex([book.id], catalogIntegration, delayed);
  expect((await vectorFor(book.id))?.texto).toStartWith(`${title} — `);
});

test("UC24: a subida do servidor reconcilia o acervo sem conexão ao Redis", async () => {
  const book = await testBook();
  await sql`DELETE FROM acervo_vetores WHERE livro_id = ${book.id}`;
  const server = Bun.spawn([process.execPath, "src/main.ts"], {
    env: { ...process.env, PORT: "0", REDIS_URL: "", EMBEDDING_PROVIDER: "hash" },
    stdout: "pipe",
  });
  try {
    // A busca por si só não reconcilia um índice existente. O vetor precisa vir da subida.
    let output = "";
    for await (const chunk of server.stdout) {
      output += new TextDecoder().decode(chunk);
      const address = output.match(/http:\/\/localhost:\d+/)?.[0];
      if (!address) continue;
      const deadline = Date.now() + 3000;
      while (!await vectorFor(book.id) && Date.now() < deadline) await Bun.sleep(20);
      const response = await fetch(`${address}/api/busca-semantica/livros?q=${encodeURIComponent(book.titulo)}`);
      expect(response.status).toBe(200);
      const hits = await response.json() as { id: number; distancia: number }[];
      expect(hits[0]?.id).toBe(book.id);
      expect(typeof hits[0]?.distancia).toBe("number");
      return;
    }
    throw new Error("O servidor encerrou antes de informar a porta");
  } finally {
    server.kill();
    await server.exited;
  }
});
