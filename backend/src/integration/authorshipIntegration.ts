import type { AuthorshipIntegration } from "../modules/authorship";
import { syncAuthorBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

export const authorshipIntegration: AuthorshipIntegration = {
  async countBooks(db, authorId) {
    const [row] = await db`SELECT COUNT(*)::int AS total FROM livros WHERE autor_id = ${authorId}` as { total: number }[];
    return row!.total;
  },
  async authorChanged(authorId) {
    // o nome do autor está no texto indexado de cada livro dele
    await syncAuthorBookIndex(authorId, catalogIntegration);
  },
};