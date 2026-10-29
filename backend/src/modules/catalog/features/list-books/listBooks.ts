import { sql } from "../../../../infrastructure/postgres";
import { civilDate } from "../../../../shared/dates";
import type { BookView } from "../../domain/Book";
import type { CatalogIntegration } from "../../domain/CatalogIntegration";
import { toBookView, type BookRow } from "../../infrastructure/books";

export async function listBooks(integration: CatalogIntegration, now = new Date()): Promise<BookView[]> { 
  let rows: BookRow[] = [];
  rows = await sql`SELECT id, isbn, titulo AS title, autor_id AS "authorId", data_catalogacao AS "catalogedOn" FROM livros ORDER BY titulo, id` as BookRow[];
  return Promise.all(rows.map((row) => toBookView(sql, row, integration, civilDate(now))));
}
