import { createDb } from "./db";
import { SqliteAutorRepository } from "./repositories/SqliteAutorRepository";
import { SqliteLivroRepository } from "./repositories/SqliteLivroRepository";
import { CadastrarLivro } from "./use-cases/CadastrarLivro";

createDb();

// ⚠️ o mesmo defeito proposital da rota: some na fase 42.
const livros = new SqliteLivroRepository();
const autores = new SqliteAutorRepository();
const cadastrarLivro = new CadastrarLivro(livros, autores, () => new Date());

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
