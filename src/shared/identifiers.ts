import { InvalidValue } from "./domain-errors";

class Identifier {
  constructor(readonly value: number) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new InvalidValue(`identificador inválido: ${value}`);
    }
  }

  equals(other: this): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}

export class LivroId extends Identifier {}

export class AutorId extends Identifier {}
