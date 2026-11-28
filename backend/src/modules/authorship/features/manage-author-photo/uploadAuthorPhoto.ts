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

export async function uploadAuthorPhoto(
  id: number,
  image: ImageUpload,
  integration: AuthorshipIntegration,
  { client = storage, now = new Date() } = {},
): Promise<AuthorView> {
  await findAuthor(sql, id);
  const key = photoKey(id);
  await putObject(key, image.bytes, image.type, client);

  const author = await inTransaction(async (tx) => {
    const [row] = await tx`
      UPDATE autores SET foto_atualizada_em = ${now} WHERE id = ${id}
      RETURNING id, nome AS name, tipo AS type, livros_no_acervo AS "bookCount"
    ` as AuthorRow[];
    return row ? toAuthorView(tx, row, integration) : null;
  });
  if (!author) {
    // O autor foi excluído enquanto a foto subia.
    await discardObject(key, client);
    throw new NotFound("Autor não encontrado");
  }
  await invalidateAuthorSearch();
  return author;
}
