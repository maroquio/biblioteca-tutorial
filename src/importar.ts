import { db, createDb } from "./db";

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
  // ⚠️ daqui para baixo é cópia do que existe em src/index.ts — mas só de
  // PARTE do que existe lá: o RF08 e o RF09 ficaram de fora. Repare nisso.
  const [isbnBruto, titulo, autorBruto] = row.split(",") as [
    string,
    string,
    string,
  ];
  const isbn = isbnBruto.replace(/[^0-9]/g, "");
  const autorId = Number(autorBruto);

  const autor = db.query("SELECT * FROM autores WHERE id = ?").get(autorId);

  if (!autor) {
    console.log(`linha rejeitada (autor não cadastrado): ${row}`);
    rejeitados++;
    continue;
  }

  const livrosDoAutor = db
    .query(
      `SELECT COUNT(*) AS total FROM livros
        WHERE autor_id = ?`,
    )
    .get(autorId) as { total: number };

  if (livrosDoAutor.total >= 3) {
    console.log(`linha rejeitada (limite atingido): ${row}`);
    rejeitados++;
    continue;
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const ano = hoje.slice(0, 4);

  const catalogadosNoAno = db
    .query(
      `SELECT COUNT(*) AS total FROM livros
        WHERE data_catalogacao LIKE ?`,
    )
    .get(`${ano}%`) as { total: number };

  const numeroRegistro = `${ano}-${String(catalogadosNoAno.total + 1).padStart(6, "0")}`;

  db.run(
    `INSERT INTO livros (numero_registro, isbn, titulo, autor_id, data_catalogacao)
     VALUES (?, ?, ?, ?, ?)`,
    [numeroRegistro, isbn, titulo, autorId, hoje],
  );

  importados++;
}

console.log(`importados: ${importados} | rejeitados: ${rejeitados}`);
