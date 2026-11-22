import { sql } from "../../../../infrastructure/postgres";
import { discardObject, putObject, storage } from "../../../../infrastructure/storage";
import { inTransaction } from "../../../../infrastructure/transaction";
import { civilDate } from "../../../../shared/dates";
import { NotFound } from "../../../../shared/errors";
import type { ImageUpload } from "../../../../shared/images";
import type { BookView } from "../../domain/Book";
import type { CatalogIntegration } from "../../domain/CatalogIntegration";
import { findBook, toBookView, type BookRow } from "../../infrastructure/books";
import { coverKey } from "../../infrastructure/covers";

/**
 * UC25: grava a capa no RustFS e depois marca no Postgres quando ela mudou.
 * Nessa ordem, uma falha no meio deixa no máximo um objeto sem uso no bucket,
 * nunca um livro apontando para uma capa que não existe.
 */
export async function uploadBookCover(
  id: number,
  image: ImageUpload,
  integration: CatalogIntegration,
  { client = storage, now = new Date() } = {},
): Promise<BookView> {
  // 404 antes de mandar qualquer byte para o RustFS
  await findBook(sql, id);
  await putObject(coverKey(id), image.bytes, image.type, client);

  const book = await inTransaction(async (tx) => {
    const [row] = await tx`
      UPDATE livros SET capa_atualizada_em = ${now} WHERE id = ${id}
      RETURNING id, isbn, titulo AS title, autor_id AS "authorId", data_catalogacao AS "catalogedOn"
    ` as BookRow[];
    return row ? toBookView(tx, row, integration, civilDate(now)) : null;
  });
  if (!book) {
    // o livro foi excluído enquanto a capa subia: o objeto não tem mais dono
    await discardObject(coverKey(id), client);
    throw new NotFound("Livro não encontrado");
  }
  return book;
}
