import { test } from "bun:test";

// Objetivo: testar SÓ a regra do limite de livros.
// Sem servidor. Sem porta. Sem banco. Sem CSV.
//
// O import que gostaríamos de escrever é este:
//
//   import { limiteDeLivros } from "../src/index";
//
// Ele não compila, e não é por falta de export.
// A regra não é uma função: é um `if` dentro de um `handler`, dentro de um
// objeto, dentro do array `routes`, dentro de `src/index.ts` — que, ao ser
// importado, sobe um servidor HTTP na porta 3000 como efeito colateral.
//
// Para exercitar essa regra hoje só existem dois caminhos:
//   1. subir a aplicação inteira e falar HTTP com ela (tests/cadastro.e2e.test.ts)
//   2. subir um processo da CLI e falar CSV com ela (tests/importacao.test.ts)
//
// Nenhum dos dois testa a regra. Os dois testam a regra ATRAVÉS de um
// mecanismo de entrega — e é por isso que a mesma regra precisou ser escrita
// duas vezes, e por isso uma das duas está errada agora.

test.todo("a regra do limite de livros deveria ser testável sozinha", () => {});
