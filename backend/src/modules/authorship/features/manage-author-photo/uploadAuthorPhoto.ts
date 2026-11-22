import { sql } from "../../../../infrastructure/postgres";
import { discardObject, putObject, storage } from "../../../../infrastructure/storage";
import { inTransaction } from "../../../../infrastructure/transaction";
import { NotFound } from "../../../../shared/errors";
import type { ImageUpload } from "../../../../shared/images";
import type { AuthorView } from "../../domain/Author";
import type { AuthorshipIntegration } from "../../domain/AuthorshipIntegration";
import { findAuthor, toAuthorView, type AuthorRow } from "../../infrastructure/authors";
import { photoKey } from "../../infrastructure/photos";
import { invalidateAuthorSearch } from "../../infrastructure/searchCache";

/**
 * UC26: grava a foto do autor no RustFS e marca no Postgres quando ela mudou.
 *
 * Segue o mesmo desenho de uploadBookCover, em
 * modules/catalog/features/manage-book-cover/uploadBookCover.ts:
 *   1. confira que o autor existe (findAuthor): 404 antes de gravar qualquer byte;
 *   2. grave o objeto em photoKey(id) com putObject, passando `client`;
 *   3. numa transação, grave foto_atualizada_em = now e monte a AuthorView
 *      (toAuthorView, com RETURNING das colunas de AuthorRow);
 *   4. se o autor sumiu no meio do caminho, descarte o objeto e responda 404;
 *   5. depois do COMMIT, invalide o cache da busca de autores. Sem isso, a busca
 *      continua devolvendo fotoUrl antiga por até 60 s.
 */
export async function uploadAuthorPhoto(
  id: number,
  image: ImageUpload,
  integration: AuthorshipIntegration,
  { client = storage, now = new Date() } = {},
): Promise<AuthorView> {
  await findAuthor(sql, id);
  await putObject(photoKey(id), image.bytes, image.type, client);

  const author = await inTransaction(async (tx) => {
    const [row] = await tx`
      UPDATE autores SET foto_atualizada_em = ${now} WHERE id = ${id}
      RETURNING id, nome AS name, tipo AS type, livros_no_acervo AS "bookCount"
    ` as AuthorRow[];
    return row ? toAuthorView(tx, row, integration) : null;
  });
  if (!author) {
    await discardObject(photoKey(id), client);
    throw new NotFound("Autor não encontrado");
  }
  await invalidateAuthorSearch();
  return author;
}
