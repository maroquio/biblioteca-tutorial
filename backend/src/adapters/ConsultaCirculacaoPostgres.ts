import type { SQL } from "bun";
import type { ConsultaDeCirculacao, DadosExemplar, DadosLeitor } from "../modules/circulacao/domain/modelo";

/** Adapter de integração: só aqui há SQL que atravessa leitores, exemplares e livros. */
export class ConsultaCirculacaoPostgres implements ConsultaDeCirculacao {
  constructor(private readonly db: SQL) {}

  async leitor(id: number): Promise<DadosLeitor | null> {
    const [row] = await this.db<DadosLeitor[]>`SELECT id, nome, cpf FROM leitores WHERE id = ${id}`;
    return row ?? null;
  }

  async exemplar(id: number): Promise<DadosExemplar | null> {
    const [row] = await this.db<DadosExemplar[]>`SELECT e.id, e.numero_registro AS "numeroRegistro", l.titulo AS "livroTitulo"
      FROM exemplares e JOIN livros l ON l.id = e.livro_id WHERE e.id = ${id}`;
    return row ?? null;
  }
}
