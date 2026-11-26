import type { RedisClient } from "bun";
import { emailSender } from "../../../infrastructure/email";
import { sql } from "../../../infrastructure/postgres";
import { enqueue, queue, type Job } from "../../../infrastructure/queue";
import { redisKey } from "../../../infrastructure/redis";
import type { EmailSender } from "../../../shared/EmailSender";
import { circulationDependencies } from "./dependencies";
import { receiptEmail } from "./receiptEmail";

/** O stream dos comprovantes. O primeiro trecho diz o dono, como toda chave do Redis. */
export const LOAN_RECEIPT_STREAM = redisKey("circulacao", "fila", "comprovantes");

/** A mensagem leva só o id do empréstimo: o resto, o worker lê na hora de enviar. */
export type LoanReceiptTask = { loanId: number };

/** O que aconteceu com um pedido de comprovante. O worker escreve isso no log. */
export type ReceiptOutcome = "enviado" | "já enviado" | "empréstimo não encontrado" | "sem remetente";

/**
 * Manda o comprovante do empréstimo ao leitor, uma vez só. Lança quando o envio
 * falha: no worker, sem o XACK, a fila entrega a mensagem de novo mais tarde.
 *
 * A marca vem depois do envio: se o envio falha, a coluna continua nula e a nova
 * tentativa manda o comprovante. Se o processo morrer entre o envio e a marca, o
 * leitor recebe o comprovante duas vezes, o que é melhor do que não receber.
 */
export async function sendLoanReceipt(loanId: number, sender: EmailSender | null = emailSender): Promise<ReceiptOutcome> {
  if (!sender) return "sem remetente";

  const [loan] = await sql`
    SELECT leitor_id AS "readerId", exemplar_id AS "copyId", data_emprestimo AS "loanedOn",
      data_prevista_devolucao AS "dueOn", comprovante_enviado_em AS "sentAt"
    FROM emprestimos WHERE id = ${loanId}
  ` as { readerId: number; copyId: number; loanedOn: string; dueOn: string; sentAt: Date | null }[];
  if (!loan) return "empréstimo não encontrado";
  // a fila entrega cada mensagem pelo menos uma vez: o leitor não pode receber dois e-mails
  if (loan.sentAt) return "já enviado";

  // o e-mail mora em Leitores: chega pela porta, lido agora, e não na hora de publicar
  const [, lookup] = circulationDependencies(sql);
  const reader = await lookup.reader(loan.readerId);
  const copy = await lookup.copy(loan.copyId);
  if (!reader || !copy) throw new Error(`Empréstimo ${loanId} sem leitor ou exemplar`);

  await sender.send(receiptEmail({
    loanId, readerName: reader.name, readerEmail: reader.email,
    bookTitle: copy.bookTitle, registrationNumber: copy.registrationNumber,
    loanedOn: loan.loanedOn, dueOn: loan.dueOn,
  }));
  await sql`UPDATE emprestimos SET comprovante_enviado_em = ${new Date()} WHERE id = ${loanId}`;
  return "enviado";
}

/**
 * UC19: pede o comprovante e volta na hora. Quem chama precisa estar depois do
 * COMMIT do empréstimo. Sem fila, ou com ela fora do ar, envia aqui mesmo.
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
    // o empréstimo já está gravado: o comprovante não pode transformá-lo num erro
    console.warn(`Comprovante do empréstimo ${loanId} não enviado:`, (error as Error).message);
  }
}

/** A tarefa do lado do worker, como bookIndexJob. A falha no envio sobe: a fila tenta de novo. */
export function loanReceiptJob(sender: EmailSender | null = emailSender): Job<LoanReceiptTask> {
  return {
    stream: LOAN_RECEIPT_STREAM,
    async handle(task) {
      // a mensagem é dado externo, como o corpo de uma requisição
      if (!Number.isInteger(task?.loanId)) throw new Error("Tarefa de comprovante sem o id do empréstimo");
      const outcome = await sendLoanReceipt(task.loanId, sender);
      // o id, e não o e-mail: o endereço do leitor é dado pessoal e não vai para o log
      console.log(`Comprovante do empréstimo ${task.loanId}: ${outcome}`);
    },
  };
}
