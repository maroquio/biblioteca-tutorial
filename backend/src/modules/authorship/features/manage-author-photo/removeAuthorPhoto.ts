import {
  discardObject,
  requireStorage,
  storage,
} from "../../../../infrastructure/storage";
import { inTransaction } from "../../../../infrastructure/transaction";
import { NotFound } from "../../../../shared/errors";
import { photoKey } from "../../infrastructure/photos";
import { invalidateAuthorSearch } from "../../infrastructure/searchCache";

/**
 * UC26: remove a foto do autor.
 *
 * TODO (atividade): siga removeBookCover, em
 * modules/catalog/features/manage-book-cover/removeBookCover.ts:
 *   1. sem RustFS (requireStorage), 503 antes de mexer no banco;
 *   2. numa transação, zere foto_atualizada_em; autor inexistente, 404;
 *   3. só então descarte o objeto em photoKey(id) com discardObject;
 *   4. invalide o cache da busca de autores.
 */
export async function removeAuthorPhoto(id: number, client = storage): Promise<void> {
  // 1. Verifica se o RustFS está disponível
  // antes de modificar o banco.
  requireStorage(client);

  // 2. Remove a referência da foto no PostgreSQL.
  const [row] = await inTransaction((tx) => tx`
    UPDATE autores
    SET foto_atualizada_em = NULL
    WHERE id = ${id}
    RETURNING id
  `);

  if (!row) {
    throw new NotFound("Autor não encontrado");
  }

  // 3. Remove o objeto do RustFS.
  await discardObject(photoKey(id), client);

  // 4. Invalida o cache depois da operação.
  await invalidateAuthorSearch();
}
