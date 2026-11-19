import { discardObject } from "../../../../infrastructure/storage";
import { inTransaction } from "../../../../infrastructure/transaction";
import { RuleConflict } from "../../../../shared/errors";
import type { AuthorshipIntegration } from "../../domain/AuthorshipIntegration";
import { findAuthor } from "../../infrastructure/authors";
import { photoKey } from "../../infrastructure/photos";
import { invalidateAuthorSearch } from "../../infrastructure/searchCache";

export async function deleteAuthor(id: number, integration: AuthorshipIntegration): Promise<void> {
  await inTransaction(async (tx) => {
    await findAuthor(tx, id);
    if (await integration.countBooks(tx, id) > 0) throw new RuleConflict("Autor possui livros e não pode ser excluído");
    await tx`DELETE FROM autores WHERE id = ${id}`;
  });
  await invalidateAuthorSearch();
  // só depois do COMMIT: um autor recusado (409) não perde a foto, e uma falha
  // do RustFS aqui só deixa um objeto órfão, sem virar 503
  await discardObject(photoKey(id));
}