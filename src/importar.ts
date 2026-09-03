import { buildUseCases } from "./composition";
import { createAcervoTables } from "./modules/acervo";
import { createAutoriaTables } from "./modules/autoria";

createAutoriaTables();
createAcervoTables();

const { cadastrarLivro } = buildUseCases();

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

  try {
    cadastrarLivro.execute({ isbn, titulo, autorId: Number(autorId) });
    importados++;
  } catch (error) {
    console.log(`linha rejeitada (${(error as Error).message}): ${row}`);
    rejeitados++;
  }
}

console.log(`importados: ${importados} | rejeitados: ${rejeitados}`);
