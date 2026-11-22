import type { SQL, TransactionSQL } from "bun";

export type AuthorshipDb = SQL | TransactionSQL;

/** O que a Autoria precisa dos outros módulos; quem implementa é integration/, dona do SQL entre módulos. */
export type AuthorshipIntegration = {
  countBooks: (db: AuthorshipDb, authorId: number) => Promise<number>;
  /** Depois do COMMIT: o nome ou o tipo do autor mudou (o índice semântico dos livros dele fica velho). */
  authorChanged: (authorId: number) => Promise<void>;
};