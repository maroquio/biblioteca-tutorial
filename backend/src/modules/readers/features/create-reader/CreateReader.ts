import { RuleConflict } from "../../../../shared/errors";
import { parseReaderInput } from "../../domain/Reader";
import type { ReaderRepository } from "../../domain/ReaderRepository";
import { invalidateReaderSearch } from "../../infrastructure/searchCache";

export class CreateReader {
  constructor(private readonly repository: ReaderRepository) {}
  async execute(body: unknown) {
    const input = parseReaderInput(body);
    if (await this.repository.cpfExists(input.cpf)) throw new RuleConflict("Já existe um leitor com este CPF.");
    await invalidateReaderSearch();
    return this.repository.insert(input);
  }
}
