import { inTransaction } from "../../../../infrastructure/transaction";
import type { AuthorInput, AuthorType, AuthorView } from "../../domain/Author";
import { invalidateAuthorSearch } from "../../infrastructure/searchCache";

export async function createAuthor(input: AuthorInput): Promise<AuthorView> {
  const author = await inTransaction(async (tx) => {
    const [row] = await tx`INSERT INTO autores (nome, tipo) VALUES (${input.name}, ${input.type}) RETURNING id, nome AS name, tipo AS type` as { id: number; name: string; type: AuthorType }[];
    return { ...row!, bookCount: 0 };
  });
  // depois do COMMIT: só agora o autor novo é visível para quem refizer a busca
  await invalidateAuthorSearch();
  return author;
}