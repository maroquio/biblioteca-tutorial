import type { RedisClient } from "bun";
import { log } from "../../../infrastructure/log";
import { enqueue, queue, type Job } from "../../../infrastructure/queue";
import { redisKey } from "../../../infrastructure/redis";
import type { CatalogIntegration } from "../domain/CatalogIntegration";
import { indexBooks, syncBookIndex } from "./bookIndex";

/** O stream da indexação. O primeiro trecho diz o dono, como toda chave do Redis. */
export const BOOK_INDEX_STREAM = redisKey("acervo", "fila", "indice-livros");

/** A mensagem leva só os ids: o worker lê o título e o autor atuais no Postgres. */
type BookIndexTask = { ids: number[] };

/**
 * Depois do COMMIT: pede ao worker que atualize o índice destes livros e volta
 * na hora. Sem fila, ou com ela fora do ar, faz o trabalho aqui mesmo, como
 * antes: mais devagar, mas o livro não fica de fora do índice.
 */
export async function scheduleBookIndex(ids: number[], integration: CatalogIntegration, client: RedisClient | null = queue): Promise<void> {
  const task: BookIndexTask = { ids };
  if (await enqueue(BOOK_INDEX_STREAM, task, client)) return;
  await syncBookIndex(ids, integration);
}

/** A tarefa do lado do worker. Ao contrário de syncBookIndex, aqui a falha sobe: a fila tenta de novo. */
export function bookIndexJob(integration: CatalogIntegration): Job<BookIndexTask> {
  return {
    stream: BOOK_INDEX_STREAM,
    async handle(task) {
      if (!Array.isArray(task?.ids) || !task.ids.every(Number.isInteger)) {
        throw new Error("Tarefa de indexação sem a lista de ids");
      }
      const { indexed, removed } = await indexBooks(task.ids, integration);
      log.info("índice semântico atualizado", { book_ids: task.ids, indexed, removed });
    },
  };
}
