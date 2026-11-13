import { expect, test } from "bun:test";
import { createHashEmbedder } from "./hashEmbedder";

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return dot / Math.sqrt(na * nb);
}

test("textos com palavras em comum ficam mais próximos", async () => {
  const [sea, cake, query] = await createHashEmbedder().embed(["Vingança no mar", "Receitas de bolo", "vingança"], "document");
  expect(cosine(sea!, query!)).toBeGreaterThan(cosine(cake!, query!));
});

test("ignora acentos e caixa", async () => {
  const [upper, plain] = await createHashEmbedder().embed(["VINGANÇA", "vinganca"], "query");
  expect(Array.from(upper!)).toEqual(Array.from(plain!));
});

test("texto sem palavras não vira vetor nulo", async () => {
  const [empty] = await createHashEmbedder(8).embed(["—"], "query");
  expect(Array.from(empty!)).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
});