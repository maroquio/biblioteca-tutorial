export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class TituloVazio extends DomainError {
  constructor() {
    super("O título do livro é obrigatório");
  }
}
