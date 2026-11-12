import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores dos livros moram no Postgres, mas continuam derivados de `livros`:
 * o seed escreve direto nas tabelas, e um cadastro feito com o Gemini fora do ar
 * fica sem vetor. Vetoriza o que falta e o que ficou com o texto desatualizado.
 */
export async function refreshBookVectors(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/**
 * Os dados derivados podem ter ficado para trás: o seed escreveu direto nas
 * tabelas. Recalcula tudo a partir de `livros` e `autores`, a fonte da verdade.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await refreshBookVectors();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache. Por isso cada conexão (a primeira e cada
 * reconexão automática) invalida o cache da busca de autores. Os vetores dos
 * livros não entram aqui: estão no Postgres e não dependem do Redis.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh: () => Promise<void> = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
