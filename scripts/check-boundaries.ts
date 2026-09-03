import { Glob } from "bun";
import { dirname, join, normalize } from "node:path";

const problems: string[] = [];

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
}

if (problems.length > 0) {
  console.error("Importações que furam a fronteira de módulo:\n");
  for (const problema of problems) console.error(`  ${problema}\n`);
  process.exit(1);
}

console.log("Fronteiras de módulo respeitadas.");
