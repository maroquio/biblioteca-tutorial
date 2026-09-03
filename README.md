# Biblioteca — uma feature, 53 fases

Tópicos Especiais em Engenharia de Software II · Ifes 2026.2

Um cadastro de livros construído em 53 passos, da API ingênua ao monólito
modular. O mesmo caso de uso atravessa o percurso inteiro: cada fase muda a forma
do código sem mudar o que ele faz, e a fase seguinte cobra o preço da anterior.

## Comece aqui

```bash
git clone https://github.com/maroquio/biblioteca-tutorial
cd biblioteca-tutorial
open .docs/tutorial-aluno.html
```

O tutorial traz as 53 fases em sequência, com o código pronto para copiar.
Este branch (`main`) tem o código no estado final, ao fim da fase 53.

## Uma branch por fase

Cada fase tem uma branch com o código **concluído** até ela e o enunciado em
`.docs/faseNN.html`.

```bash
git checkout fase10             # o projeto ao fim da fase 10
git diff fase09 fase10          # exatamente o que a fase 10 mudou
git log --oneline fase10        # as dez fases até aqui
```

| Marco | Branches |
|---|---|
| Preparação | `fase01` – `fase08` |
| A API ingênua | `fase09` – `fase19` |
| A dor | `fase20` – `fase23` |
| A primeira reação | `fase24` – `fase30` |
| O domínio | `fase31` – `fase37` |
| Ports, casos de uso, payoff | `fase38` – `fase45` |
| Fatias e módulos | `fase46` – `fase53` |

## Requisitos

[Bun](https://bun.sh) 1.2 ou mais novo. Nenhum banco a instalar: o SQLite vem
embutido no Bun, e o arquivo é criado na primeira execução.

```bash
bun install
bun run dev
```
