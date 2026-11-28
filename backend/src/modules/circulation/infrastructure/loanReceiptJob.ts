import type { RedisClient } from "bun";
import { emailSender } from "../../../infrastructure/email";
import { sql } from "../../../infrastructure/postgres";
import { enqueue, queue, type Job } from "../../../infrastructure/queue";
import { redisKey } from "../../../infrastructure/redis";
import type { EmailSender } from "../../../shared/EmailSender";
import { circulationDependencies } from "./dependencies";
import { receiptEmail } from "./receiptEmail";

const RECEIPT_STREAM = redisKey("circulacao", "fila", "comprovantes");

/** A mensagem leva só o id do empréstimo: o resto, o worker lê na hora de enviar. */
export type LoanReceiptTask = { loanId: number };

/** O que aconteceu com um pedido de comprovante. O worker escreve isso no log. */
export type ReceiptOutcome = "enviado" | "já enviado" | "empréstimo não encontrado" | "sem remetente";

/**
 * Manda o comprovante do empréstimo ao leitor, uma vez só. Lança quando o envio
 * falha: no worker, sem o XACK, a fila entrega a mensagem de novo mais tarde.
 * O bloqueio é só deste empréstimo, sem usar o lock global de inTransaction.
 * Assim, dois workers não enviam simultaneamente o mesmo comprovante.
 */
export async function sendLoanReceipt(loanId: number, sender: EmailSender | null = emailSender): Promise<ReceiptOutcome> {
  if (!sender) return "sem remetente";
  return await sql.begin(async (tx): Promise<ReceiptOutcome> => {
    const [loan] = await tx`
      SELECT id, leitor_id AS "readerId", exemplar_id AS "copyId",
        data_emprestimo AS "loanedOn", data_prevista_devolucao AS "dueOn",
        comprovante_enviado_em AS "receiptSentAt"
      FROM emprestimos WHERE id = ${loanId} FOR UPDATE
    ` as { id: number; readerId: number; copyId: number; loanedOn: string; dueOn: string; receiptSentAt: Date | null }[];
    if (!loan) return "empréstimo não encontrado";
    if (loan.receiptSentAt) return "já enviado";

    // Os dados atuais de outros módulos chegam pela porta, sem SQL entre módulos.
    const [, lookup] = circulationDependencies(tx);
    const reader = await lookup.reader(loan.readerId);
    const copy = await lookup.copy(loan.copyId);
    if (!reader || !copy) throw new Error("Dados do comprovante do empréstimo não encontrados");
    await sender.send(receiptEmail({
      loanId: loan.id,
      readerName: reader.name,
      readerEmail: reader.email,
      bookTitle: copy.bookTitle,
      registrationNumber: copy.registrationNumber,
      loanedOn: loan.loanedOn,
      dueOn: loan.dueOn,
    }));
    // Marca depois do envio: falhas permitem tentar novamente. Uma queda entre
    // o envio e o COMMIT pode repetir o e-mail, em vez de perder o comprovante.
    await tx`UPDATE emprestimos SET comprovante_enviado_em = NOW() WHERE id = ${loanId}`;
    return "enviado";
  });
}

/**
 * UC19: pede o comprovante e volta na hora. Quem chama precisa estar depois do
 * COMMIT do empréstimo.
 * Sem fila, tenta enviar diretamente. A falha vira aviso, preservando o empréstimo.
 */
export async function scheduleLoanReceipt(
  loanId: number,
  { client = queue, sender = emailSender }: { client?: RedisClient | null; sender?: EmailSender | null } = {},
): Promise<void> {
  if (await enqueue(RECEIPT_STREAM, { loanId }, client)) return;
  try {
    await sendLoanReceipt(loanId, sender);
  } catch {
    console.warn(`Comprovante do empréstimo ${loanId}: envio indisponível; empréstimo preservado`);
  }
}

/**
 * A tarefa do lado do worker, como bookIndexJob.
 * Valida a mensagem e registra só o id e o resultado, sem expor o e-mail do leitor.
 */
export function loanReceiptJob(sender: EmailSender | null = emailSender): Job<LoanReceiptTask> {
  return {
    stream: RECEIPT_STREAM,
    async handle(task) {
      if (!Number.isSafeInteger(task?.loanId) || task.loanId <= 0) {
        throw new Error("Tarefa de comprovante sem o id do empréstimo");
      }
      const outcome = await sendLoanReceipt(task.loanId, sender);
      console.log(`Comprovante do empréstimo ${task.loanId}: ${outcome}`);
    },
  };
}
