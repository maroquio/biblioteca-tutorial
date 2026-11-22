import { expect, test } from "bun:test";
import { createGeminiEmbedder } from "./gemini";

type Captured = { url: string; headers: Headers; body: { requests: Record<string, unknown>[] } };

/** Um fetch falso: guarda cada requisição e responde, por texto, um vetor [i, 0, 0, ...] de `size` posições. */
function fakeFetch({ status = 200, size = 3 } = {}) {
  const calls: Captured[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: new Headers(init.headers), body });
    const embeddings = body.requests.map((_: unknown, i: number) => ({ values: [i, ...Array(size - 1).fill(0)] }));
    return new Response(JSON.stringify(status === 200 ? { embeddings } : { error: {} }), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

test("envia o lote ao batchEmbedContents com a chave no cabeçalho", async () => {
  const { calls, fetch } = fakeFetch({ size: 768 });
  await createGeminiEmbedder("chave-secreta", { fetch }).embed(["um", "dois"], "query");
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents");
  expect(calls[0]!.headers.get("x-goog-api-key")).toBe("chave-secreta");
  // no lote, a API só respeita taskType e outputDimensionality no topo de cada request
  expect(calls[0]!.body.requests).toEqual([
    { model: "models/gemini-embedding-001", content: { parts: [{ text: "um" }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 },
    { model: "models/gemini-embedding-001", content: { parts: [{ text: "dois" }] }, taskType: "RETRIEVAL_QUERY", outputDimensionality: 768 },
  ]);
});

test("converte values em Float32Array", async () => {
  const { fetch } = fakeFetch();
  const embedder = createGeminiEmbedder("k", { fetch, dimensions: 3 });
  const [first, second] = await embedder.embed(["a", "b"], "document");
  expect(first).toBeInstanceOf(Float32Array);
  expect(Array.from(second!)).toEqual([1, 0, 0]);
  expect(embedder.id).toBe("gemini-embedding-001-3");
  expect(embedder.dimensions).toBe(3);
});

test("divide em lotes de 100", async () => {
  const { calls, fetch } = fakeFetch();
  const vectors = await createGeminiEmbedder("k", { fetch, dimensions: 3 }).embed(Array.from({ length: 150 }, (_, i) => `t${i}`), "document");
  expect(calls.map((c) => c.body.requests.length)).toEqual([100, 50]);
  expect(calls[0]!.body.requests[0]!.taskType).toBe("RETRIEVAL_DOCUMENT");
  expect(vectors).toHaveLength(150);
});

test("status 429 lança erro", async () => {
  const { fetch } = fakeFetch({ status: 429 });
  await expect(createGeminiEmbedder("k", { fetch }).embed(["a"], "query")).rejects.toThrow("Gemini respondeu 429");
});

test("vetor com dimensão diferente da configurada lança erro", async () => {
  // o índice do Redis recusaria o vetor em silêncio (hash_indexing_failures)
  const { fetch } = fakeFetch({ size: 3072 });
  await expect(createGeminiEmbedder("k", { fetch }).embed(["a"], "query")).rejects.toThrow("Gemini devolveu 3072 dimensões; o índice espera 768");
});