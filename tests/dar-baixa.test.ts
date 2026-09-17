import { expect, test } from "bun:test";
import { CadastrarLivro } from "../src/modules/acervo/features/cadastrar-livro/CadastrarLivro";
import { DarBaixa } from "../src/modules/acervo/features/dar-baixa/DarBaixa";
import { InvalidValue, RuleViolation } from "../src/shared/domain-errors";
import { NotFound } from "../src/shared/errors";
import {
    FakeEventPublisher,
    InMemoryAutoria,
    InMemoryLivroRepository,
} from "./doubles";

const AUSTEN = 4;
const LIVROS = [
    { isbn: "9780141439518", titulo: "Orgulho e Preconceito" },
    { isbn: "9780141439662", titulo: "Razão e Sensibilidade" },
    { isbn: "9780141439587", titulo: "Emma" },
    { isbn: "9780141439761", titulo: "Persuasão" },
    { isbn: "9780141439563", titulo: "A Abadia de Northanger" },
    { isbn: "9780141199689", titulo: "Lady Susan" },
];

const deAusten = (n: number) => ({ ...LIVROS[n]!, autorId: AUSTEN });

function scenario() {
    const livros = new InMemoryLivroRepository();
    const events = new FakeEventPublisher();
    const autoria = new InMemoryAutoria({
        [AUSTEN]: { nome: "Jane Austen", tiragem: "curta", livrosNoAcervo: 0 },
    });

    return {
        events,
        cadastrar: new CadastrarLivro(
            livros,
            autoria,
            () => new Date("2026-03-10"),
            events,
        ),
        darBaixa: new DarBaixa(livros, autoria, () => new Date("2026-09-17"), events),
    };
}

test("a baixa grava o motivo e a data do servidor", () => {
    const { cadastrar, darBaixa } = scenario();
    const livro = cadastrar.execute(deAusten(0));

    const baixado = darBaixa.execute({
        numeroRegistro: livro.numeroRegistro,
        motivo: "dano",
    });

    expect(baixado.baixa).toEqual({ motivo: "dano", em: "2026-09-17" });
});

test("a baixa anuncia LivroBaixado", () => {
    const { cadastrar, darBaixa, events } = scenario();
    const livro = cadastrar.execute(deAusten(0));

    darBaixa.execute({ numeroRegistro: livro.numeroRegistro, motivo: "extravio" });

    expect(events.published.at(-1)).toEqual({
        nome: "LivroBaixado",
        autorId: AUSTEN,
        numeroRegistro: "2026-000001",
        motivo: "extravio",
        em: "2026-09-17",
    });
});

test("um livro não sai do acervo duas vezes", () => {
    const { cadastrar, darBaixa } = scenario();
    const livro = cadastrar.execute(deAusten(0));
    const pedido = { numeroRegistro: livro.numeroRegistro, motivo: "dano" };

    darBaixa.execute(pedido);

    expect(() => darBaixa.execute(pedido)).toThrow(RuleViolation);
});

test("motivo fora do vocabulário do domínio é recusado", () => {
    const { cadastrar, darBaixa } = scenario();
    const livro = cadastrar.execute(deAusten(0));

    expect(() =>
        darBaixa.execute({ numeroRegistro: livro.numeroRegistro, motivo: "cansei" }),
    ).toThrow(InvalidValue);
});

test("número de registro que não está no acervo devolve NotFound", () => {
    const { darBaixa } = scenario();

    expect(() =>
        darBaixa.execute({ numeroRegistro: "2026-999999", motivo: "dano" }),
    ).toThrow(NotFound);
});

test("livro baixado libera a vaga no limite e o título", () => {
    const { cadastrar, darBaixa } = scenario();

    for (let i = 0; i < 5; i++) cadastrar.execute(deAusten(i));

    // Orgulho e Preconceito sai do acervo: o limite volta a ter vaga...
    darBaixa.execute({ numeroRegistro: "2026-000001", motivo: "dano" });
    expect(cadastrar.execute(deAusten(5)).titulo).toBe("Lady Susan");

    darBaixa.execute({ numeroRegistro: "2026-000006", motivo: "doacao" });

    // ... e o mesmo título pode voltar, numa nova edição
    const reposto = cadastrar.execute({
        isbn: "9780141040349",
        titulo: "Orgulho e Preconceito",
        autorId: AUSTEN,
    });

    expect(reposto.numeroRegistro).toBe("2026-000007");
});