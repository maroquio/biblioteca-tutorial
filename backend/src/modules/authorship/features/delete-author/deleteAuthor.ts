import { inTransaction } from "../../../../infrastructure/transaction";
import { RuleConflict } from "../../../../shared/errors";
import type { AuthorshipIntegration } from "../../domain/AuthorshipIntegration";
import { findAuthor } from "../../infrastructure/authors";
import { invalidateAuthorSearch } from "../../infrastructure/searchCache";
import { photoKey } from "../../infrastructure/photos";
import { discardObject, storage } from "../../../../infrastructure/storage";

export async function deleteAuthor(id: number, integration: AuthorshipIntegration): Promise<void> {
  await inTransaction(async (tx) => {
    await findAuthor(tx, id);
    if (await integration.countBooks(tx, id) > 0) throw new RuleConflict("Autor possui livros e não pode ser excluído");
    await tx`DELETE FROM autores WHERE id = ${id}`;
  });
  await invalidateAuthorSearch();
  // TODO (atividade, UC26): depois do COMMIT, descarte a foto do autor no bucket,
  // como deleteBook faz com a capa (discardObject e photoKey).

  // Remove a foto sem desfazer a exclusão caso o RustFS falhe.
  await discardObject(photoKey(id), storage);
}