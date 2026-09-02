import { InvalidValue } from "./errors";

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

  toString(): string {
    return this.value;
  }
}
