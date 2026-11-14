import type { RedisClient } from "bun";
import { redis } from "../infrastructure/redis";
import { invalidateAuthorSearch } from "../modules/authorship";
import { reconcileBookIndex } from "../modules/catalog";
import { catalogIntegration } from "./catalogIntegration";

/**
 * Os vetores da busca semântica moram no Postgres: indexa os livros que ficaram
 * sem vetor (o seed escreve direto nas tabelas, o Gemini pode ter estado fora do
 * ar) e refaz os de texto desatualizado. Não depende do Redis.
 */
export async function reconcileSemanticIndex(): Promise<void> {
  const { indexed } = await reconcileBookIndex(catalogIntegration);
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
}

/**
 * Os dados derivados podem ter ficado para trás: o servidor esteve parado
 * enquanto o banco mudou, ou o seed escreveu direto nas tabelas.
 * Recalcula tudo a partir do Postgres, a fonte da verdade.
 */
export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await reconcileSemanticIndex();
}

/**
 * Enquanto o Redis esteve fora, as escritas no Postgres continuaram, mas não
 * conseguiram invalidar o cache de autores. Por isso cada conexão (a primeira e
 * cada reconexão automática) o invalida. Os vetores dos livros não passam por
 * aqui: estão no Postgres e não perdem nada quando o Redis cai.
 */
export function refreshDerivedDataOnConnect(client: RedisClient | null = redis, refresh = invalidateAuthorSearch): void {
  if (!client) return;
  client.onconnect = () => { void refresh(); };
}
