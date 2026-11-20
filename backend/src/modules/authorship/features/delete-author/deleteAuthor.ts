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
  // UC26: só depois do COMMIT, quando a exclusão foi confirmada (um autor com
  // livros é recusado com 409 e precisa continuar com a foto), ela sai do bucket.
  // discardObject nunca lança: uma falha do RustFS aqui só deixa um objeto órfão,
  // e não transforma em 503 uma exclusão que o Postgres já confirmou.
  await discardObject(photoKey(id));
}