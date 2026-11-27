import type { RedisClient } from "bun";
import { emailSender } from "../../../infrastructure/email";
import { sql } from "../../../infrastructure/postgres";
import { enqueue, queue, type Job } from "../../../infrastructure/queue";
import { redisKey } from "../../../infrastructure/redis";
import type { EmailSender } from "../../../shared/EmailSender";
import { circulationDependencies } from "./dependencies";
import { receiptEmail } from "./receiptEmail";

/** O stream dos comprovantes. O primeiro trecho diz o módulo dono, como toda chave do Redis. */
export const LOAN_RECEIPT_STREAM = redisKey("circulacao", "fila", "comprovantes");

/** A mensagem leva só o id do empréstimo: o resto, o worker lê na hora de enviar. */
export type LoanReceiptTask = { loanId: number };

/** O que aconteceu com um pedido de comprovante. O worker escreve isso no log. */
export type ReceiptOutcome = "enviado" | "já enviado" | "empréstimo não encontrado" | "sem remetente";

type LoanReceiptRow = {
  id: number;
  readerId: number;
  copyId: number;
  loanedOn: string;
  dueOn: string;
  receiptSentAt: Date | null;
};

/**
 * Manda o comprovante do empréstimo ao leitor, uma vez só. Lança quando o envio
 * falha: no worker, sem o XACK, a fila entrega a mensagem de novo mais tarde.
 *
 * A marcação em comprovante_enviado_em acontece depois de sender.send: se o
 * provedor falhar, a coluna segue nula para a nova tentativa; se o processo
 * morrer entre o envio e o UPDATE, prefere-se um comprovante duplicado a deixar
 * o leitor sem nenhum.
 */
export async function sendLoanReceipt(loanId: number, sender: EmailSender | null = emailSender): Promise<ReceiptOutcome> {
  if (!sender) return "sem remetente";

  const [row] = await sql<LoanReceiptRow[]>`
    SELECT id, leitor_id AS "readerId", exemplar_id AS "copyId",
           data_emprestimo AS "loanedOn", data_prevista_devolucao AS "dueOn",
           comprovante_enviado_em AS "receiptSentAt"
    FROM emprestimos
    WHERE id = ${loanId}
  `;
  if (!row) return "empréstimo não encontrado";
  if (row.receiptSentAt) return "já enviado";

  const [, lookup] = circulationDependencies(sql);
  const [reader, copy] = await Promise.all([lookup.reader(row.readerId), lookup.copy(row.copyId)]);
  if (!reader || !copy) return "empréstimo não encontrado";

  await sender.send(receiptEmail({
    loanId: row.id,
    readerName: reader.name,
    readerEmail: reader.email,
    bookTitle: copy.bookTitle,
    registrationNumber: copy.registrationNumber,
    loanedOn: row.loanedOn,
    dueOn: row.dueOn,
  }));

  await sql`UPDATE emprestimos SET comprovante_enviado_em = NOW() WHERE id = ${row.id}`;
  return "enviado";
}

/**
 * UC19: pede o comprovante e volta na hora. Quem chama precisa estar depois do
 * COMMIT do empréstimo.
 */
export async function scheduleLoanReceipt(
  loanId: number,
  { client = queue, sender = emailSender }: { client?: RedisClient | null; sender?: EmailSender | null } = {},
): Promise<void> {
  const task: LoanReceiptTask = { loanId };
  if (await enqueue(LOAN_RECEIPT_STREAM, task, client)) return;
  try {
    await sendLoanReceipt(loanId, sender);
  } catch (error) {
    console.warn(`Comprovante do empréstimo ${loanId} indisponível:`, (error as Error).message);
  }
}

/** A tarefa do lado do worker, como bookIndexJob. */
export function loanReceiptJob(sender: EmailSender | null = emailSender): Job<LoanReceiptTask> {
  return {
    stream: LOAN_RECEIPT_STREAM,
    async handle(task) {
      if (!Number.isInteger(task?.loanId)) {
        throw new Error("Tarefa de comprovante sem o id do empréstimo");
      }
      const outcome = await sendLoanReceipt(task.loanId, sender);
      console.log(`Comprovante do empréstimo ${task.loanId}: ${outcome}`);
    },
  };
}
