import { invalidateReaderSearch } from "../..";
import { inTransaction } from "../../../../infrastructure/transaction";
import { RuleConflict } from "../../../../shared/errors";
import { parseReaderInput } from "../../domain/Reader";
import type { ReaderRepository } from "../../domain/ReaderRepository";

export class CreateReader {
  constructor(private readonly repository: ReaderRepository) {}
  async execute(body: unknown) {
    let insert;
    await inTransaction(async (tx) => {
      const input = parseReaderInput(body);
      if (await this.repository.cpfExists(input.cpf)) throw new RuleConflict("Já existe um leitor com este CPF.");
       insert = this.repository.insert(input);
    });
    await invalidateReaderSearch();
    return insert;
  }
}
