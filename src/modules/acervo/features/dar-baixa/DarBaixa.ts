import type { Clock } from "../../../../shared/Clock";
import { NotFound } from "../../../../shared/errors";
import { Baixa } from "../../domain/Baixa";
import type { ConsultaDeAutoria } from "../../domain/ConsultaDeAutoria";
import type { EventPublisher } from "../../domain/events";
import type { LivroRepository } from "../../domain/LivroRepository";
import { NumeroRegistro } from "../../domain/NumeroRegistro";
import { livroToJson, type LivroJson } from "../../output";
import type { PedidoDeBaixa } from "./input";

export class DarBaixa {
    constructor(
        private readonly livros: LivroRepository,
        private readonly autoria: ConsultaDeAutoria,
        private readonly now: Clock,
        private readonly events: EventPublisher,
    ) { }

    execute(input: PedidoDeBaixa): LivroJson {
        const numero = new NumeroRegistro(input.numeroRegistro);
        const baixa = Baixa.registrar(input.motivo, this.now());

        const livro = this.livros.findByNumeroRegistro(numero);

        if (!livro) {
            throw new NotFound("Livro não encontrado");
        }

        const baixado = livro.darBaixa(baixa);

        this.livros.registrarBaixa(baixado);

        this.events.publish({
            nome: "LivroBaixado",
            autorId: baixado.autorId.value,
            numeroRegistro: baixado.numeroRegistro.value,
            motivo: baixa.motivo,
            em: baixa.em,
        });

        return livroToJson(baixado, this.autoria.autor(baixado.autorId)!);
    }
}