import { Glob } from "bun";
import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const problems: string[] = [];


const TABLE_OWNERS: Record<string, string> = {
  livros: "catalog",
  exemplares: "catalog",
  acervo_sequencias: "catalog",
  autores: "authorship",
  autoria_migracoes: "authorship",
  leitores: "readers",
  reservas: "circulation",
  emprestimos: "circulation",
};


const KEY_OWNERS: Record<string, string> = {
  autoria: "authorship",
  acervo: "catalog",
  leitores: "readers",
};


function sliceOf(path: string): string | null {
  const parts = path.split("/");
  return parts[3] === "features" && parts[4] ? parts.slice(0, 5).join("/") : null;
}

for await (const rawFile of new Glob("src/modules/**/*.ts").scan(".")) {
  const file = rawFile.replaceAll("\\", "/");
  if (file.endsWith(".test.ts")) continue;

  const module = file.split("/")[2]!;
  const slice = sliceOf(file);
  const code = await Bun.file(file).text();

  for (const found of code.matchAll(/from\s+"(\.[^"]+)"/g)) {
    const target = normalize(join(dirname(file), found[1]!)).replaceAll("\\", "/");

    if (!target.startsWith("src/modules/")) continue;

    const otherModule = target.split("/")[2]!;
    if (otherModule !== module) {
      if (target !== `src/modules/${otherModule}`) {
        problems.push(`${file}\n      importa ${target}`);
      }
      continue;
    }

    const targetSlice = sliceOf(target);
    if (targetSlice && targetSlice !== slice) {
      problems.push(`${file}\n      importa a fatia ${targetSlice}`);
    }
  }

  for (const [table, owner] of Object.entries(TABLE_OWNERS)) {
    if (owner === module) continue;

    if (new RegExp(`\\b(FROM|JOIN|INTO|UPDATE|TABLE|EXISTS)\\s+${table}\\b`, "i").test(code)) {
      problems.push(
        `${file}\n      toca a tabela "${table}", que pertence a ${owner}`,
      );
    }
  }

  for (const found of code.matchAll(/redisKey\(\s*"(\w+)"/g)) {
    const owner = KEY_OWNERS[found[1]!];
    if (owner !== module) {
      problems.push(
        `${file}\n      toca a chave Redis "${found[1]}:*", que pertence a ${owner ?? "nenhum módulo"}`,
      );
    }
  }
}


const FRONTEND = "../frontend";

if (existsSync(FRONTEND)) {
  for await (const rawFile of new Glob("src/modules/**/*.{ts,tsx}").scan(FRONTEND)) {
    const file = rawFile.replaceAll("\\", "/");
    const module = file.split("/")[2]!;
    const slice = sliceOf(file);
    const code = await Bun.file(join(FRONTEND, file)).text();

    for (const found of code.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = normalize(join(dirname(file), found[1]!)).replaceAll("\\", "/");

      if (!target.startsWith("src/modules/")) continue;

      const otherModule = target.split("/")[2]!;
      if (otherModule !== module) {
        if (target !== `src/modules/${otherModule}/index.ts`) {
          problems.push(`frontend/${file}\n      importa ${target}`);
        }
        continue;
      }

      const targetSlice = sliceOf(target);
      if (targetSlice && targetSlice !== slice) {
        problems.push(`frontend/${file}\n      importa a fatia ${targetSlice}`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error("Importações que furam a fronteira de módulo:\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}

console.log("Fronteiras de módulo respeitadas.");
