import { NotFound } from "../../../shared/errors";
import type { AuthorType, AuthorView } from "../domain/Author";
import type { AuthorshipDb, AuthorshipIntegration } from "../domain/AuthorshipIntegration";

export type AuthorRow = { id: number; name: string; type: AuthorType; bookCount: number };

export async function findAuthor(db: AuthorshipDb, id: number): Promise<AuthorRow> {
  const [row] = await db`SELECT id, nome AS name, tipo AS type, livros_no_acervo AS "bookCount" FROM autores WHERE id = ${id}` as AuthorRow[];
  if (!row) throw new NotFound("Autor não encontrado");
  return row;
}

export async function toAuthorView(db: AuthorshipDb, row: AuthorRow, integration: AuthorshipIntegration): Promise<AuthorView> {
  const [photo] = await db`SELECT foto_atualizada_em AS "photoUpdatedAt" FROM autores WHERE id = ${row.id}` as { photoUpdatedAt: Date | null }[];
  return {
    id: row.id, name: row.name, type: row.type, bookCount: await integration.countBooks(db, row.id),
    photoVersion: photo?.photoUpdatedAt?.getTime() ?? null,
  };
}
