import { InvalidInput } from "./errors";

function getBodyAsObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null) {
    throw new InvalidInput("o corpo da requisição deve ser um objeto JSON");
  }

  return body as Record<string, unknown>;
}

function getFieldAsText(body: Record<string, unknown>, field: string): string {
  const value = body[field];

  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidInput(`campo obrigatório: ${field}`);
  }

  return value.trim();
}

function getFieldAsPositiveInt(body: Record<string, unknown>, field: string): number {
  const value = Number(body[field]);

  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidInput(`campo inválido: ${field}`);
  }

  return value;
}

export type NovoLivro = {
  isbn: string;
  titulo: string;
  autorId: number;
};

export function parseNovoLivro(body: unknown): NovoLivro {
  const data = getBodyAsObject(body);

  return {
    isbn: getFieldAsText(data, "isbn"),
    titulo: getFieldAsText(data, "titulo"),
    autorId: getFieldAsPositiveInt(data, "autorId"),
  };
}

export function parseBusca(params: Record<string, string>): string {
  return getFieldAsText(params, "q");
}
