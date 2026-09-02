import { createDb } from "./db";
import { cadastrarLivro } from "./services/livroService";

createDb();

const path = process.argv[2];

if (!path) {
  console.error("uso: bun run importar <arquivo.csv>");
  process.exit(1);
}

const content = await Bun.file(path).text();
const rows = content.trim().split("\n").slice(1);

let importados = 0;
let rejeitados = 0;

for (const row of rows) {
  const [isbn, titulo, autorId] = row.split(",") as [string, string, string];

  const result = cadastrarLivro(isbn, titulo, Number(autorId));

  if (result.ok) {
    importados++;
  } else {
    console.log(`linha rejeitada (${result.error}): ${row}`);
    rejeitados++;
  }
}

console.log(`importados: ${importados} | rejeitados: ${rejeitados}`);
