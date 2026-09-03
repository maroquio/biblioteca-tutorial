import { Glob } from "bun";
import { dirname, join, normalize } from "node:path";

const problems: string[] = [];

/** Quem é o dono de cada tabela. Nenhum módulo cita uma tabela que não é dele. */
const TABELAS: Record<string, string> = {
  livros: "acervo",
  autores: "autoria",
};

for await (const file of new Glob("src/modules/**/*.ts").scan(".")) {
  const module = file.split("/")[2]!;
  const code = await Bun.file(file).text();

  for (const found of code.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const target = normalize(join(dirname(file), found[1]!));

    if (!target.startsWith("src/modules/")) continue;

    const otherModule = target.split("/")[2]!;
    if (otherModule === module) continue;

    if (target !== `src/modules/${otherModule}`) {
      problems.push(`${file}\n      importa ${target}`);
    }
  }

  for (const [tabela, dono] of Object.entries(TABELAS)) {
    if (dono === module) continue;

    if (new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE|EXISTS)\\s+${tabela}\\b`, "i").test(code)) {
      problems.push(
        `${file}\n      toca a tabela "${tabela}", que pertence a ${dono}`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("Importações que furam a fronteira de módulo:\n");
  for (const problema of problems) console.error(`  ${problema}\n`);
  process.exit(1);
}

console.log("Fronteiras de módulo respeitadas.");
