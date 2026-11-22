import type { Embedder, EmbeddingPurpose } from "../shared/Embedder";

/** A API aceita no máximo 100 textos por chamada de batchEmbedContents. */
const BATCH_SIZE = 100;

const TASK_TYPES: Record<EmbeddingPurpose, string> = {
  document: "RETRIEVAL_DOCUMENT",
  query: "RETRIEVAL_QUERY",
};

/**
 * Adaptador do Gemini (plano gratuito, chave do Google AI Studio), chamado por
 * REST com fetch, sem SDK. Documentos e consultas usam taskTypes diferentes: o
 * modelo otimiza cada lado da busca. 768 dimensões bastam para títulos curtos e
 * ocupam um quarto do tamanho padrão (3072).
 */
export function createGeminiEmbedder(
  apiKey: string,
  { model = "gemini-embedding-001", dimensions = 768, maxDistance = 0.38, fetch = globalThis.fetch }:
    { model?: string; dimensions?: number; maxDistance?: number; fetch?: typeof globalThis.fetch } = {},
): Embedder {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;

  async function embedBatch(texts: string[], purpose: EmbeddingPurpose): Promise<Float32Array[]> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        // a referência marca taskType e outputDimensionality do topo como "deprecated" em favor
        // de embedContentConfig, mas no lote só o topo é respeitado (testado em 2026-10-29)
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType: TASK_TYPES[purpose],
          outputDimensionality: dimensions,
        })),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Gemini respondeu ${response.status}`);
    const { embeddings } = await response.json() as { embeddings: { values: number[] }[] };
    // o Redis recusaria em silêncio um vetor do tamanho errado: melhor falhar alto aqui
    const wrong = embeddings.find((embedding) => embedding.values.length !== dimensions);
    if (wrong) throw new Error(`Gemini devolveu ${wrong.values.length} dimensões; o índice espera ${dimensions}`);
    return embeddings.map((embedding) => Float32Array.from(embedding.values));
  }

  return {
    id: `${model}-${dimensions}`,
    dimensions,
    maxDistance,
    async embed(texts, purpose) {
      const vectors: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += BATCH_SIZE) {
        vectors.push(...await embedBatch(texts.slice(start, start + BATCH_SIZE), purpose));
      }
      return vectors;
    },
  };
}