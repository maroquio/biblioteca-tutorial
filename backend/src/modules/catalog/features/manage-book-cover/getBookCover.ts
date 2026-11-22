import { sql } from "../../../../infrastructure/postgres";
import { getObject, storage, type StoredObject } from "../../../../infrastructure/storage";
import { NotFound } from "../../../../shared/errors";
import { coverKey } from "../../infrastructure/covers";

/**
 * UC25: o Postgres diz se o livro tem capa; o RustFS guarda os bytes. Quem pede
 * a capa de um livro sem capa recebe 404 sem que o RustFS seja consultado.
 */
export async function getBookCover(id: number, client = storage): Promise<StoredObject> {
  const [row] = await sql`SELECT capa_atualizada_em AS "coverUpdatedAt" FROM livros WHERE id = ${id}` as { coverUpdatedAt: Date | null }[];
  if (!row) throw new NotFound("Livro não encontrado");
  if (!row.coverUpdatedAt) throw new NotFound("Livro sem capa");

  const cover = await getObject(coverKey(id), client);
  // a coluna diz que há capa, mas o objeto sumiu do bucket (volume apagado, por exemplo)
  if (!cover) throw new NotFound("Livro sem capa");
  return cover;
}
