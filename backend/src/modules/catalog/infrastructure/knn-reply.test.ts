import { expect, test } from "bun:test";
import { parseKnnReply } from "./bookIndex";

const PREFIX = "biblioteca:acervo:livro:";
const EXPECTED = [{ id: 12, distance: 0.1 }, { id: 7, distance: 0.3 }];

test("lê a resposta RESP3 do FT.SEARCH, que é a que o Bun recebe", () => {
  const reply = {
    attributes: [], format: "STRING", total_results: 2, warning: [],
    results: [
      { id: `${PREFIX}12`, extra_attributes: { distancia: "0.1" }, values: [] },
      { id: `${PREFIX}7`, extra_attributes: { distancia: "0.3" }, values: [] },
    ],
  };
  expect(parseKnnReply(reply, PREFIX)).toEqual(EXPECTED);
});

test("lê a resposta RESP2 do FT.SEARCH", () => {
  const reply = [2, `${PREFIX}12`, ["distancia", "0.1"], `${PREFIX}7`, ["distancia", "0.3"]];
  expect(parseKnnReply(reply, PREFIX)).toEqual(EXPECTED);
});
