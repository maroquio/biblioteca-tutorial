import { InvalidValue } from "../../../shared/domain-errors";

export class Orcid {
  readonly value: string;

  constructor(raw: string) {
    if (!Orcid.isValid(raw)) {
      throw new InvalidValue(`ORCID inválido: ${raw}`);
    }

    this.value = Orcid.formatar(Orcid.normalizar(raw));
  }

  /**
   * Perguntar antes de construir — o mesmo contrato do Isbn. Quem cadastra
   * exige um ORCID válido; quem apenas consulta pode querer saber se o que
   * foi digitado é um ORCID sem que isso vire erro.
   */
  static isValid(raw: string): boolean {
    const normalizado = Orcid.normalizar(raw);

    return (
      /^[0-9]{15}[0-9X]$/.test(normalizado) && Orcid.digitoConfere(normalizado)
    );
  }

  /**
   * ISO 7064 MOD 11-2: acumula (total + dígito) * 2 nos 15 primeiros
   * caracteres; o 16º é o que fecha a conta — e pode ser X, que vale 10.
   */
  private static digitoConfere(orcid: string): boolean {
    let total = 0;

    for (let i = 0; i < 15; i++) {
      total = (total + Number(orcid[i]!)) * 2;
    }

    const resto = total % 11;
    const calculado = (12 - resto) % 11;

    return (calculado === 10 ? "X" : String(calculado)) === orcid[15];
  }

  private static normalizar(raw: string): string {
    return raw.replace(/[^0-9Xx]/g, "").toUpperCase();
  }

  /** O ORCID é publicado em grupos de quatro; guardamos como é publicado. */
  private static formatar(digitos: string): string {
    return digitos.match(/.{4}/g)!.join("-");
  }

  equals(other: Orcid): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}