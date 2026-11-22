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
  // depois do COMMIT: um autor recusado (409) nunca chega aqui e mantém a foto.
  // discardObject não lança: o autor já saiu do Postgres, e uma falha do RustFS
  // só deixa um objeto órfão no bucket, em vez de virar um 503 mentiroso
  await discardObject(photoKey(id));
}