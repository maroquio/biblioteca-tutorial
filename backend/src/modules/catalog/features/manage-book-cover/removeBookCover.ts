import { discardObject, requireStorage, storage } from "../../../../infrastructure/storage";
import { inTransaction } from "../../../../infrastructure/transaction";
import { NotFound } from "../../../../shared/errors";
import { coverKey } from "../../infrastructure/covers";

/**
 * UC25: a ordem é a inversa do envio. Primeiro o Postgres esquece a capa; depois
 * o objeto sai do bucket. Se o RustFS falhar nesse último passo, sobra um objeto
 * órfão, mas nenhum livro aponta para ele.
 */
export async function removeBookCover(id: number, client = storage): Promise<void> {
  // sem RustFS, 503 antes de mexer no banco
  requireStorage(client);
  const [row] = await inTransaction((tx) => tx`UPDATE livros SET capa_atualizada_em = NULL WHERE id = ${id} RETURNING id`);
  if (!row) throw new NotFound("Livro não encontrado");
  await discardObject(coverKey(id), client);
}
