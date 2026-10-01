import { InvalidValue } from "../../../shared/domain-errors";

export class NumeroRegistro {
  static readonly DIGITOS_DO_SEQUENCIAL = 6;

  readonly value: string;

  constructor(raw: string) {
    if (!/^\d{4}-\d{6}$/.test(raw)) {
      throw new InvalidValue(`número de registro inválido: ${raw}`);
    }

    this.value = raw;
  }

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
