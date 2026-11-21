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
  // UC26: só depois do COMMIT a foto sai do bucket. Um autor recusado (409) não
  // chega aqui e mantém a foto; e, como discardObject nunca lança erro, uma falha
  // do RustFS só deixa um objeto órfão, sem transformar a exclusão já feita em 503.
  await discardObject(photoKey(id));
}
