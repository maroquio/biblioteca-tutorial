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
 * O objeto vem antes da coluna: uma falha no armazenamento não altera o autor.
 * A busca só é invalidada depois do COMMIT, quando a foto nova já está visível.
 */
export async function uploadAuthorPhoto(
  id: number,
  image: ImageUpload,
  integration: AuthorshipIntegration,
  { client = storage, now = new Date() } = {},
): Promise<AuthorView> {
  // Autor inexistente é 404 antes de enviar qualquer byte ao RustFS.
  await findAuthor(sql, id);
  await putObject(photoKey(id), image.bytes, image.type, client);

  const author = await inTransaction(async (tx) => {
    const [row] = await tx`
      UPDATE autores SET foto_atualizada_em = ${now} WHERE id = ${id}
      RETURNING id, nome AS name, tipo AS type, livros_no_acervo AS "bookCount"
    ` as AuthorRow[];
    // A mesma conexão enxerga a data atualizada antes do COMMIT.
    return row ? toAuthorView(tx, row, integration) : null;
  });
  if (!author) {
    // O autor foi excluído enquanto a foto subia: o objeto ficou sem dono.
    await discardObject(photoKey(id), client);
    throw new NotFound("Autor não encontrado");
  }
  await invalidateAuthorSearch();
  return author;
}
