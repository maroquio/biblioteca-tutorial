import { InvalidInput } from "./errors";

export function getBodyAsObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new InvalidInput("o corpo da requisição deve ser um objeto JSON");
  }

  return body as Record<string, unknown>;
}

export function getFieldAsText(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidInput(`campo obrigatório: ${field}`);
  }

  return value.trim();
}

export function getFieldAsPositiveInt(
  body: Record<string, unknown>,
  field: string,
): number {
  const value = Number(body[field]);

  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidInput(`campo inválido: ${field}`);
  }

  return value;
}
