export class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInput extends ApplicationError {}

export class NotFound extends ApplicationError {}

export class RuleConflict extends ApplicationError {}

/** Um serviço externo (Redis, provedor de embeddings) não respondeu: HTTP 503. */
export class ServiceUnavailable extends ApplicationError {}

/** O corpo da requisição passa do tamanho aceito: HTTP 413. */
export class PayloadTooLarge extends ApplicationError {}

/** Parte do contrato que ainda não foi implementada (o esqueleto de uma atividade): HTTP 501. */
export class NotImplemented extends ApplicationError {}
