/** O texto é guardado no índice (documento) ou é o que o usuário digitou (consulta). */
export type EmbeddingPurpose = "document" | "query";

/**
 * Port: transformar textos em vetores. O domínio não sabe se quem responde é o
 * Gemini, outro provedor ou o embedder de hash dos testes; só sabe que textos
 * de sentido parecido viram vetores próximos.
 */
export type Embedder = {
  /** Modelo + dimensão. Mudou o id, os vetores antigos não servem mais: o índice é recriado. */
  id: string;
  dimensions: number;
  /** Até que distância cosseno um resultado ainda conta como relacionado. Depende do modelo. */
  maxDistance: number;
  embed(texts: string[], purpose: EmbeddingPurpose): Promise<Float32Array[]>;
};