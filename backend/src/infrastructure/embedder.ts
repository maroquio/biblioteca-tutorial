import type { Embedder } from "../shared/Embedder";
import { createGeminiEmbedder } from "./gemini";
import { createHashEmbedder } from "./hashEmbedder";

/**
 * Escolhe o embedder pelo ambiente. A suíte de testes usa EMBEDDING_PROVIDER=hash;
 * a aplicação usa o Gemini quando há chave. Sem chave, null: as escritas seguem
 * normalmente, sem indexar, e a busca semântica responde 503.
 */
export function chooseEmbedder(env: Record<string, string | undefined>): Embedder | null {
  if (env.EMBEDDING_PROVIDER === "hash") return createHashEmbedder();
  if (env.GEMINI_API_KEY) return createGeminiEmbedder(env.GEMINI_API_KEY, { maxDistance: Number(env.SEMANTIC_MAX_DISTANCE ?? 0.38) });
  return null;
}

export const embedder: Embedder | null = chooseEmbedder(process.env);