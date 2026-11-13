import type { Embedder } from "../shared/Embedder";

/** FNV-1a de 32 bits: um hash simples e estável para sortear a posição de cada palavra. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Embedder determinístico, sem rede, para os testes e para estudar o mecanismo.
 * Não entende significado, só sobreposição de palavras: cada palavra soma 1 numa
 * posição do vetor. "vingança" fica perto de "Vingança no mar", mas "mistério"
 * não fica perto de "Assassinato no Expresso do Oriente". Para isso existe o Gemini.
 */
export function createHashEmbedder(dimensions = 1024): Embedder {
  return {
    id: `hash-${dimensions}`,
    dimensions,
    maxDistance: 0.6,
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(dimensions);
        const words = text.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        for (const word of words) vector[fnv1a(word) % dimensions]! += 1;
        // a distância cosseno não existe para o vetor nulo
        if (words.length === 0) vector[0] = 1;
        return vector;
      });
    },
  };
}