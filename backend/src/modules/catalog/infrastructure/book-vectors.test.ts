import { beforeAll, expect, test } from "bun:test";
import { Glob } from "bun";
import { join } from "node:path";
import { api, testAuthor, testIsbn } from "#tests/api";
import { embedder as defaultEmbedder } from "../../../infrastructure/embedder";
import { createHashEmbedder } from "../../../infrastructure/hashEmbedder";
import { sql } from "../../../infrastructure/postgres";
import { catalogIntegration } from "../../../integration/catalogIntegration";
import type { Embedder } from "../../../shared/Embedder";
import { ensureBookIndex, knnSearch, reconcileBookIndex, syncBookIndex, toPgvector } from "./bookVectors";
import { prepareCatalog } from "./schema";

// a suíte roda com EMBEDDING_PROVIDER=hash: cada escrita de livro grava um vetor de verdade, sem rede
const embedder = defaultEmbedder!;
// dublês de embedder copiam o id e a dimensão do padrão: senão o ensure acharia
// que o modelo mudou e recriaria a tabela que os outros testes usam (armadilha 4)
const base = createHashEmbedder();

type StoredRow = { texto: string; dims: number; vetor: string };

async function stored(bookId: number): Promise<StoredRow | undefined> {
  const [row] = await sql`
    SELECT texto, vector_dims(vetor) AS dims, vetor::text AS vetor
    FROM livros_vetores WHERE livro_id = ${bookId}
  ` as StoredRow[];
  return row;
}

async function createBook(title: string, authorId: number): Promise<{ id: number; isbn: string }> {
  const response = await api("POST", "/livros", { isbn: testIsbn(), titulo: title, autorId: authorId });
  expect(response.status).toBe(201);
  return response.json();
}

async function columnType(): Promise<string | null> {
  const [row] = await sql`
    SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute
    WHERE attrelid = to_regclass('livros_vetores') AND attname = 'vetor'
  ` as { type: string }[];
  return row?.type ?? null;
}

async function booksWithoutVector(): Promise<number> {
  const [row] = await sql`
    SELECT COUNT(*)::int AS total FROM livros l
    LEFT JOIN livros_vetores v ON v.livro_id = l.id
    WHERE v.livro_id IS NULL
  ` as { total: number }[];
  return row!.total;
}

function token(): string {
  return crypto.randomUUID().slice(0, 8);
}

beforeAll(async () => {
  await ensureBookIndex(embedder);
});

// ---------- infraestrutura e esquema ----------

test("UC24: a extensão vector é criada pela aplicação, e o prepare pode rodar de novo", async () => {
  // a primeira vez foi no tests/api.ts; rodar de novo não pode falhar
  await prepareCatalog();
  const [extension] = await sql`SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'` as { version: string }[];
  expect(extension?.version).toBeDefined();
});

test("UC24: livros_vetores aponta para livros com ON DELETE CASCADE e tem índice HNSW cosseno", async () => {
  const [fk] = await sql`
    SELECT confrelid::regclass::text AS "references", confdeltype::text AS "onDelete"
    FROM pg_constraint WHERE conrelid = 'livros_vetores'::regclass AND contype = 'f'
  ` as { references: string; onDelete: string }[];
  expect(fk).toEqual({ references: "livros", onDelete: "c" });

  const [index] = await sql`
    SELECT indexdef FROM pg_indexes WHERE tablename = 'livros_vetores' AND indexname = 'livros_vetores_vetor_idx'
  ` as { indexdef: string }[];
  expect(index!.indexdef).toContain("USING hnsw (vetor vector_cosine_ops)");
  expect(await columnType()).toBe(`vector(${embedder.dimensions})`);
});

test("UC24: a consulta KNN pode usar o índice HNSW", async () => {
  const [query] = await embedder.embed(["qualquer consulta"], "query");
  const literal = toPgvector(query!);
  // com poucos livros o planejador prefere o Seq Scan; desligá-lo só nesta transação
  // mostra que a forma da consulta (a mesma do knnSearch) é a que o índice acelera
  const plan = await sql.begin(async (tx) => {
    await tx`SET LOCAL enable_seqscan = off`;
    return await tx.unsafe(`
      EXPLAIN SELECT livro_id, distancia FROM (
        SELECT livro_id, vetor <=> '${literal}'::vector AS distancia
        FROM livros_vetores ORDER BY vetor <=> '${literal}'::vector LIMIT 10
      ) AS vizinhos WHERE distancia <= 0.6 ORDER BY distancia
    `) as { "QUERY PLAN": string }[];
  });
  expect(plan.map((line) => line["QUERY PLAN"]).join("\n")).toContain("Index Scan using livros_vetores_vetor_idx");
});

test("UC24: <=> é 1 − cos(θ), a mesma distância do Redis: o limiar não muda", async () => {
  const a = Float32Array.from([0.9, 0.1, 0]);
  const b = Float32Array.from([1, 0, 0]);
  const [row] = await sql`SELECT ${toPgvector(a)}::vector <=> ${toPgvector(b)}::vector AS distance` as { distance: number }[];
  const cos = (0.9 * 1) / (Math.hypot(0.9, 0.1, 0) * 1);
  expect(typeof row!.distance).toBe("number");
  expect(row!.distance).toBeCloseTo(1 - cos, 6);
});

// ---------- indexação ----------

test("UC24: cadastrar um livro grava o texto \"Título — Autor\" e um vetor da dimensão do embedder", async () => {
  const author = await testAuthor();
  const title = `Livro ${token()}`;
  const book = await createBook(title, author.id);
  const row = await stored(book.id);
  expect(row?.texto).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(embedder.dimensions);
});

test("UC24: editar o título atualiza o texto e o vetor", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const before = await stored(book.id);
  const title = `Novo título ${token()}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);
  const after = await stored(book.id);
  expect(after?.texto).toBe(`${title} — ${author.nome}`);
  expect(after?.vetor).not.toBe(before?.vetor);
});

test("UC24: excluir o livro remove a linha do vetor (ON DELETE CASCADE)", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  expect(await stored(book.id)).toBeDefined();
  expect((await api("DELETE", `/livros/${book.id}`)).status).toBe(204);
  expect(await stored(book.id)).toBeUndefined();
});

test("UC24: renomear o autor atualiza o texto dos livros dele", async () => {
  const author = await testAuthor();
  const first = await createBook(`Livro ${token()}`, author.id);
  const second = await createBook(`Livro ${token()}`, author.id);
  const name = `Autora ${token()}`;
  expect((await api("PUT", `/autores/${author.id}`, { nome: name, tipo: "literatura" })).status).toBe(200);
  expect((await stored(first.id))?.texto).toEndWith(`— ${name}`);
  expect((await stored(second.id))?.texto).toEndWith(`— ${name}`);
});

test("UC24: sincronizar de novo com o texto igual não chama o embedder", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  let calls = 0;
  const counting: Embedder = { ...base, embed: (texts, purpose) => { calls++; return base.embed(texts, purpose); } };

  expect(await syncBookIndex([book.id], catalogIntegration, counting)).toEqual({ indexed: 0, removed: 0 });
  expect(calls).toBe(0);

  // o texto mudou por fora (como faria o seed): agora sim paga o embedding, uma vez
  await sql`UPDATE livros SET titulo = ${`Outro título ${token()}`} WHERE id = ${book.id}`;
  expect(await syncBookIndex([book.id, book.id], catalogIntegration, counting)).toEqual({ indexed: 1, removed: 0 });
  expect(calls).toBe(1);
});

test("UC24: com um embedder que falha, a sincronização não lança e o vetor antigo fica até a reconciliação", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const before = await stored(book.id);
  const title = `Renomeado com o Gemini fora ${token()}`;
  await sql`UPDATE livros SET titulo = ${title} WHERE id = ${book.id}`;

  const down: Embedder = { ...base, embed: async () => { throw new Error("fora do ar"); } };
  expect(await syncBookIndex([book.id], catalogIntegration, down)).toEqual({ indexed: 0, removed: 0 });
  expect(await stored(book.id)).toEqual(before!);

  // a reconciliação acha o texto desatualizado e refaz o vetor
  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThanOrEqual(1);
  expect((await stored(book.id))?.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: com o embedder fora do ar, o cadastro do livro responde 201 e o livro fica sem vetor", async () => {
  const author = await testAuthor();
  const title = `Cadastrado com o Gemini fora ${token()}`;
  // o caso de uso usa o embedder padrão: ele "cai" só durante este cadastro
  const original = embedder.embed;
  embedder.embed = async () => { throw new Error("fora do ar"); };
  let book: { id: number };
  try {
    book = await createBook(title, author.id);
  } finally {
    embedder.embed = original;
  }
  expect((await api("GET", `/livros/${book.id}`)).status).toBe(200);
  expect(await stored(book.id)).toBeUndefined();

  await reconcileBookIndex(catalogIntegration);
  expect((await stored(book.id))?.texto).toBe(`${title} — ${author.nome}`);
});

test("UC24: livro inserido direto com SQL, como faz o seed, ganha vetor na reconciliação", async () => {
  const author = await testAuthor();
  const title = `Livro do seed ${token()}`;
  const [book] = await sql`
    INSERT INTO livros (isbn, titulo, autor_id, data_catalogacao)
    VALUES (${testIsbn()}, ${title}, ${author.id}, '2026-01-01') RETURNING id
  ` as { id: number }[];
  expect(await stored(book!.id)).toBeUndefined();

  expect((await reconcileBookIndex(catalogIntegration)).indexed).toBeGreaterThanOrEqual(1);
  const row = await stored(book!.id);
  expect(row?.texto).toBe(`${title} — ${author.nome}`);
  expect(row?.dims).toBe(embedder.dimensions);
  expect(await booksWithoutVector()).toBe(0);
});

test("UC24: uma sincronização atrasada não sobrescreve o vetor de uma edição mais nova", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  await sql`UPDATE livros SET titulo = ${`Título intermediário ${token()}`} WHERE id = ${book.id}`;

  // um "Gemini" lento: a sincronização lê o título intermediário e fica esperando
  let reached!: () => void;
  let release!: () => void;
  const embedding = new Promise<void>((resolve) => { reached = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const slow: Embedder = { ...base, embed: async (texts, purpose) => { reached(); await gate; return base.embed(texts, purpose); } };
  const late = syncBookIndex([book.id], catalogIntegration, slow);
  await embedding;

  // enquanto isso, uma edição pela API grava o título final e o vetor dele
  const title = `Título final ${token()}`;
  expect((await api("PUT", `/livros/${book.id}`, { isbn: book.isbn, titulo: title, autorId: author.id })).status).toBe(200);

  release();
  expect(await late).toEqual({ indexed: 0, removed: 0 });
  expect((await stored(book.id))?.texto).toBe(`${title} — ${author.nome}`);
});

// ---------- busca ----------

test("UC24: knnSearch ordena pela distância e corta pelo limiar", async () => {
  const author = await testAuthor();
  const tok = token();
  const near = await createBook(`Cometa azul ${tok}`, author.id);
  await createBook(`Cometa ${tok} vermelho distante`, author.id);
  // o mesmo texto que foi indexado: distância (quase) zero
  const [query] = await embedder.embed([`Cometa azul ${tok} — ${author.nome}`], "query");

  const hits = await knnSearch(query!, { limit: 10, maxDistance: embedder.maxDistance });
  expect(hits[0]!.id).toBe(near.id);
  expect(hits[0]!.distance).toBeCloseTo(0, 5);
  for (let i = 1; i < hits.length; i++) expect(hits[i]!.distance).toBeGreaterThanOrEqual(hits[i - 1]!.distance);
  expect(hits.every((hit) => hit.distance <= embedder.maxDistance)).toBe(true);

  const strict = await knnSearch(query!, { limit: 10, maxDistance: 1e-4 });
  expect(strict.map((hit) => hit.id)).toEqual([near.id]);
});

test("UC24: nenhum arquivo do Acervo importa o Redis", async () => {
  const catalog = join(import.meta.dir, "..");
  const importsRedis: string[] = [];
  for await (const file of new Glob("**/*.ts").scan(catalog)) {
    if (file.endsWith(".test.ts")) continue;
    const code = await Bun.file(join(catalog, file)).text();
    if (/from\s+"[^"]*infrastructure\/redis"/.test(code)) importsRedis.push(file);
  }
  expect(importsRedis).toEqual([]);
});

// ---------- troca de modelo (por último: mexe na tabela que todos usam) ----------

test("UC24: um embedder de outra dimensão refaz a tabela e reindexa os livros", async () => {
  const author = await testAuthor();
  const book = await createBook(`Livro ${token()}`, author.id);
  const other = createHashEmbedder(512);
  try {
    // duas chamadas ao mesmo tempo: só uma recria a tabela
    const created = await Promise.all([ensureBookIndex(other), ensureBookIndex(other)]);
    expect(created.filter(Boolean)).toHaveLength(1);
    expect(await columnType()).toBe("vector(512)");
    expect(await ensureBookIndex(other)).toBe(false);

    expect((await reconcileBookIndex(catalogIntegration, other)).indexed).toBeGreaterThanOrEqual(1);
    expect((await stored(book.id))?.dims).toBe(512);
    expect(await booksWithoutVector()).toBe(0);
  } finally {
    // devolve o banco de testes ao embedder padrão, e espera terminar (armadilha 4)
    await reconcileBookIndex(catalogIntegration, embedder);
  }
  expect(await columnType()).toBe(`vector(${embedder.dimensions})`);
  expect((await stored(book.id))?.dims).toBe(embedder.dimensions);
  expect(await booksWithoutVector()).toBe(0);
});

test("UC24: mesmo modelo com outro id (mesma dimensão) também refaz a tabela", async () => {
  // dois modelos de 1024 dimensões não se comparam: a dimensão sozinha não basta
  const twin: Embedder = { ...base, id: `outro-modelo-${base.dimensions}` };
  try {
    expect(await ensureBookIndex(twin)).toBe(true);
    expect(await columnType()).toBe(`vector(${base.dimensions})`);
    const [table] = await sql`SELECT obj_description('livros_vetores'::regclass, 'pg_class') AS model` as { model: string }[];
    expect(table!.model).toBe(twin.id);
  } finally {
    await reconcileBookIndex(catalogIntegration, embedder);
  }
  expect(await booksWithoutVector()).toBe(0);
});
