import { discardObject, requireStorage, storage } from "../../../../infrastructure/storage";
import { inTransaction } from "../../../../infrastructure/transaction";
import { NotFound } from "../../../../shared/errors";
import { photoKey } from "../../infrastructure/photos";
import { invalidateAuthorSearch } from "../../infrastructure/searchCache";

/**
 * UC26: remove a foto do autor.
 * Primeiro o Postgres esquece a foto; depois o objeto sai do bucket.
 * Uma falha na limpeza pode deixar um órfão, mas não uma referência quebrada.
 */
export async function removeAuthorPhoto(id: number, client = storage): Promise<void> {
  // Sem cliente configurado, responde 503 sem alterar o autor.
  requireStorage(client);
  const [row] = await inTransaction((tx) => tx`
    UPDATE autores SET foto_atualizada_em = NULL WHERE id = ${id} RETURNING id
  `);
  if (!row) throw new NotFound("Autor não encontrado");
  await discardObject(photoKey(id), client);
  await invalidateAuthorSearch();
}
