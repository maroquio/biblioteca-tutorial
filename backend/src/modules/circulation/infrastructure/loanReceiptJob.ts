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

type LoanRow = { readerId: number; copyId: number; loanedOn: string; dueOn: string; sentAt: Date | null };

/**
 * Manda o comprovante do empréstimo ao leitor, uma vez só. Lança quando o envio
 * falha: no worker, sem o XACK, a fila entrega a mensagem de novo mais tarde.
 *
 * Primeiro envia, depois marca. Se o processo morrer entre os dois, a fila
 * entrega a mensagem de novo e o leitor recebe o comprovante repetido. Na ordem
 * inversa, ele poderia não receber nenhum. Para um comprovante, um e-mail
 * repetido é melhor do que nenhum.
 */
export async function sendLoanReceipt(loanId: number, sender: EmailSender | null = emailSender): Promise<ReceiptOutcome> {
  if (!sender) return "sem remetente";

  const [loan] = await sql`
    SELECT leitor_id AS "readerId", exemplar_id AS "copyId", data_emprestimo AS "loanedOn",
      data_prevista_devolucao AS "dueOn", comprovante_enviado_em AS "sentAt"
    FROM emprestimos WHERE id = ${loanId}
  ` as LoanRow[];
  if (!loan) return "empréstimo não encontrado";
  // a fila entrega cada mensagem pelo menos uma vez: a coluna diz o que já saiu
  if (loan.sentAt) return "já enviado";

  // o e-mail mora em Leitores: chega pela porta, lido agora, e não na hora do empréstimo
  const [, lookup] = circulationDependencies(sql);
  const [reader, copy] = await Promise.all([lookup.reader(loan.readerId), lookup.copy(loan.copyId)]);
  if (!reader || !copy) throw new Error(`Empréstimo ${loanId} sem leitor ou sem exemplar`);

  await sender.send(receiptEmail({
    loanId,
    readerName: reader.name,
    readerEmail: reader.email,
    bookTitle: copy.bookTitle,
    registrationNumber: copy.registrationNumber,
    loanedOn: loan.loanedOn,
    dueOn: loan.dueOn,
  }));
  // só chega aqui se o envio deu certo: uma falha deixa a coluna nula para a nova tentativa
  await sql`UPDATE emprestimos SET comprovante_enviado_em = now() WHERE id = ${loanId} AND comprovante_enviado_em IS NULL`;
  return "enviado";
}

/**
 * UC19: pede o comprovante e volta na hora. Quem chama precisa estar depois do
 * COMMIT do empréstimo. Sem fila, ou com ela fora do ar, envia aqui mesmo, e uma
 * falha vira só um aviso: o empréstimo já está gravado.
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
    console.warn(`Comprovante do empréstimo ${loanId} não enviado:`, (error as Error).message);
  }
}

/** A tarefa do lado do worker. Ao contrário do envio na hora, aqui a falha sobe: a fila tenta de novo. */
export function loanReceiptJob(sender: EmailSender | null = emailSender): Job<LoanReceiptTask> {
  return {
    stream: LOAN_RECEIPT_STREAM,
    async handle(task) {
      if (!Number.isInteger(task?.loanId)) throw new Error("Tarefa do comprovante sem o id do empréstimo");
      const outcome = await sendLoanReceipt(task.loanId, sender);
      // o log leva o id do empréstimo, nunca o e-mail do leitor (dado pessoal)
      console.log(`Comprovante do empréstimo ${task.loanId}: ${outcome}`);
    },
  };
}
