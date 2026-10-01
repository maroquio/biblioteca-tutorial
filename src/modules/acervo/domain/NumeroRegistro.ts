import type { Hono } from "hono";
import type { UseCases } from "../../../composition";
import { InvalidValue } from "../../../shared/domain-errors";
import { parseCorrecaoDeTitulo } from "./CorrecaoDeTitulo";

export class NumeroRegistro {
  /** O formato do número de registro é decisão do negócio, não do banco. */
  static readonly DIGITOS_DO_SEQUENCIAL = 6;

  readonly value: string;

  constructor(raw: string) {
    if (!/^\d{4}-\d{6}$/.test(raw)) {
      throw new InvalidValue(`número de registro inválido: ${raw}`);
    }

    this.value = raw;
  }

  /** O número de registro nasce por aqui: ano da catalogação + sequencial daquele ano. */
  static proximo(ano: string, catalogadosNoAno: number): NumeroRegistro {
    const sequencial = String(catalogadosNoAno + 1).padStart(
      NumeroRegistro.DIGITOS_DO_SEQUENCIAL,
      "0",
    );

    return new NumeroRegistro(`${ano}-${sequencial}`);
  }

  toString(): string {
    return this.value;
  }
}
export function register(routes: Hono, useCases: UseCases): void {
  routes.patch("/livros/:id/titulo", async (contexto: { req: { param: () => { id?: string; }; json: () => unknown; }; json: (arg0: any, arg1: number) => any; }) => {
    const input = parseCorrecaoDeTitulo(
      contexto.req.param(),
      await contexto.req.json(),
    );
    return contexto.json(useCases.corrigirTitulo.execute(input), 200);
  });
}
