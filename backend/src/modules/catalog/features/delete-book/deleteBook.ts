import { inTransaction } from "../../../../infrastructure/transaction";
import { RuleConflict } from "../../../../shared/errors";
import type { CatalogIntegration } from "../../domain/CatalogIntegration";
import { syncBookIndex } from "../../infrastructure/bookVectors";
import { findBook } from "../../infrastructure/books";

export async function deleteBook(id: number, integration: CatalogIntegration): Promise<void> {
  const book = await inTransaction(async (tx) => {
    const book = await findBook(tx, id);
    const [table] = await tx`SELECT to_regclass('public.exemplares') IS NOT NULL AS "exists"` as { exists: boolean }[];
    if (table!.exists) {
      const [link] = await tx`SELECT id FROM exemplares WHERE livro_id = ${id} LIMIT 1`;
      if (link) throw new RuleConflict("Livro possui exemplares e não pode ser excluído");
    } else {
      const [legacy] = await tx`SELECT id FROM livros WHERE id = ${id} AND numero_registro IS NOT NULL`;
      if (legacy) throw new RuleConflict("Livro possui exemplar legado; integre UC13 antes de excluí-lo");
    }
    await tx`DELETE FROM livros WHERE id = ${id}`;
    await integration.syncAuthorBookCounts(tx, [book.authorId]);
    return book;
  });
  await integration.bookCountsChanged([book.authorId]);
  await syncBookIndex([id], integration);
}
