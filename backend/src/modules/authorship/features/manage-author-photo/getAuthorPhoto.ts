import { sql } from "bun";
import { getObject, storage, type StoredObject } from "../../../../infrastructure/storage";
import { NotFound, NotImplemented } from "../../../../shared/errors";
import { photoKey } from "../../infrastructure/photos";

/**
 * UC26: o Postgres diz se o autor tem foto; o RustFS guarda os bytes.
 *
 * TODO (atividade): siga getBookCover, em
 * modules/catalog/features/manage-book-cover/getBookCover.ts:
 *   1. leia foto_atualizada_em do autor: 404 "Autor não encontrado" se ele não
 *      existe, 404 "Autor sem foto" se a coluna é nula, sem consultar o RustFS;
 *   2. leia o objeto em photoKey(id) com getObject, passando `client`;
 *   3. objeto ausente (a coluna diz que há foto, mas o bucket não tem): 404.
 */
export async function getAuthorPhoto(id: number, client = storage): Promise<StoredObject> {
  const [row] = await sql`SELECT foto_atualizada_em AS "photoUpdateAt" FROM autores WHERE id = ${id}` as { photoUpdateAt: Date | null }[];
  if (!row) throw new NotFound("Autor não encontrado");
  if (!row.photoUpdateAt) throw new NotFound("Autor sem foto");

  const photo = await getObject(photoKey(id), client);
  if (!photo) throw new NotFound("Autor sem Foto");
  return photo;
}
