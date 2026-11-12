import type { ReaderRepository } from "../../domain/ReaderRepository";

import { sql } from "../../../../infrastructure/postgres";



export class SearchReaders {
  constructor(private readonly repository: ReaderRepository) {}
  execute(term?: string) { return this.repository.search(term); }
  get(id: number) { return this.repository.get(id); }
}


export async function searchAuthors(term: string, integration: AuthorshipIntegration): Promise<AuthorView[]> {
  const q = term.trim();
  const id = /^\d+$/.test(q) ? Number(q) : 0;
  const rows = await sql`SELECT id, nome AS name, tipo AS type, livros_no_acervo AS "bookCount" FROM autores WHERE ${q} = '' OR id = ${id} OR nome ILIKE ${'%' + q + '%'} ORDER BY nome, id` as AuthorRow[];
  return Promise.all(rows.map((row) => toAuthorView(sql, row, integration)));
}















