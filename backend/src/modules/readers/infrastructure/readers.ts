import { NotFound } from "../../../shared/errors";
import type { AuthorType, AuthorView } from "../domain/Author";
import type { AuthorshipDb, AuthorshipIntegration } from "../domain/AuthorshipIntegration";

export type ReaderRow = { id: number; name: string; type: ReaderType; bookCount: number };

export async function findReader(db: ReadersDb, id: number): Promise<ReaderRow> {
  const [row] = await db`SELECT id, nome AS name, tipo AS type, livros_no_acervo AS "bookCount" FROM leitores WHERE id = ${id}` as ReaderRow[];
  if (!row) throw new NotFound("Leitor não encontrado");
  return row;
}

export async function toReaderView(db: ReadersDb, row: ReaderRow, integration: ReadersIntegration): Promise<ReaderView> {
  return { id: row.id, name: row.name, type: row.type, bookCount: await integration.countBooks(db, row.id) };
}
