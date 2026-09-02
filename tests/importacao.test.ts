import { beforeEach, expect, test } from "bun:test";
import { db, createDb } from "../src/db";

const AUSTEN = 4;
const LIVROS = [
  { isbn: "9780141439518", titulo: "Orgulho e Preconceito" },
  { isbn: "9780141439662", titulo: "Razão e Sensibilidade" },
  { isbn: "9780141439587", titulo: "Emma" },
  { isbn: "9780141439761", titulo: "Persuasão" },
  { isbn: "9780141439563", titulo: "A Abadia de Northanger" },
  { isbn: "9780141199689", titulo: "Lady Susan" },
];

createDb();

beforeEach(() => {
  db.run("DELETE FROM livros");
});

async function importar(csv: string): Promise<void> {
  await Bun.write("data/importacao-teste.csv", csv);

  const processo = Bun.spawn(
    ["bun", "src/importar.ts", "data/importacao-teste.csv"],
    { stdout: "ignore" },
  );

  await processo.exited;
}

function noAcervo(autorId: number): number {
  const row = db
    .query(
      `SELECT COUNT(*) AS total FROM livros
        WHERE autor_id = ?`,
    )
    .get(autorId) as { total: number };

  return row.total;
}

function linhasCsv(livros: typeof LIVROS, autorId: number): string {
  return (
    "isbn,titulo,autorId\n" +
    livros.map((l) => `${l.isbn},${l.titulo},${autorId}`).join("\n") +
    "\n"
  );
}

test("RF05 também vale para a importação em lote", async () => {
  const csv = linhasCsv(LIVROS.slice(0, 6), AUSTEN);

  await importar(csv);

  expect(noAcervo(AUSTEN)).toBe(3);
});
