export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidValue extends DomainError {}

export class RuleViolation extends DomainError {}
