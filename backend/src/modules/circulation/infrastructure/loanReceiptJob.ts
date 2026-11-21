import type { RedisClient } from "bun";
import { emailSender } from "../../../infrastructure/email";
import { enqueue, queue, type Job } from "../../../infrastructure/queue";
import type { EmailSender } from "../../../shared/EmailSender";
import { redisKey } from "../../../infrastructure/redis";
import { sql } from "../../../infrastructure/postgres";
import { circulationDependencies } from "./dependencies";
import { receiptEmail } from "./receiptEmail";

/** A mensagem leva só o id do empréstimo: o resto, o worker lê na hora de enviar. */
export type LoanReceiptTask = { loanId: number };

/** O que aconteceu com um pedido de comprovante. O worker escreve isso no log. */
export type ReceiptOutcome = "enviado" | "já enviado" | "empréstimo não encontrado" | "sem remetente";

/** O stream dos comprovantes. O primeiro trecho diz o dono, como toda chave do Redis. */
export const LOAN_RECEIPT_STREAM = redisKey("circulacao", "fila", "comprovantes");

type LoanRow = {
  id: number;
  readerId: number;
  copyId: number;
  /** AAAA-MM-DD, como no banco */
  loanedOn: string;
  /** AAAA-MM-DD, como no banco */
  dueOn: string;
  receiptSentAt: Date | null;
};

/**
 * Manda o comprovante do empréstimo ao leitor, uma vez só. Lança quando o envio
 * falha: no worker, sem o XACK, a fila entrega a mensagem de novo mais tarde.
 *
 * Envia primeiro e marca depois. Se o processo morrer entre as duas coisas, a
 * nova tentativa manda o e-mail de novo: um comprovante repetido é um estrago
 * menor que um comprovante que nunca chega.
 */
export async function sendLoanReceipt(loanId: number, sender: EmailSender | null = emailSender): Promise<ReceiptOutcome> {
  if (!sender) return "sem remetente";

  const [loan] = await sql`
    SELECT id, leitor_id AS "readerId", exemplar_id AS "copyId",
           data_emprestimo AS "loanedOn", data_prevista_devolucao AS "dueOn",
           comprovante_enviado_em AS "receiptSentAt"
    FROM emprestimos WHERE id = ${loanId}
  ` as LoanRow[];
  if (!loan) return "empréstimo não encontrado";
  // a fila entrega cada mensagem pelo menos uma vez: o leitor não pode receber dois e-mails
  if (loan.receiptSentAt) return "já enviado";

  // nome e e-mail ATUAIS do leitor, lidos pela porta: o e-mail mora em Leitores
  const [, lookup] = circulationDependencies(sql);
  const [reader, copy] = await Promise.all([lookup.reader(loan.readerId), lookup.copy(loan.copyId)]);
  if (!reader || !copy) throw new Error(`O empréstimo ${loanId} aponta para um leitor ou exemplar que não existe`);

  await sender.send(receiptEmail({
    loanId,
    readerName: reader.name,
    readerEmail: reader.email,
    bookTitle: copy.bookTitle,
    registrationNumber: copy.registrationNumber,
    loanedOn: loan.loanedOn,
    dueOn: loan.dueOn,
  }));
  // o AND ... IS NULL preserva a data do primeiro envio se dois workers chegarem juntos
  await sql`UPDATE emprestimos SET comprovante_enviado_em = now() WHERE id = ${loanId} AND comprovante_enviado_em IS NULL`;
  return "enviado";
}

/**
 * UC19: pede o comprovante e volta na hora. Quem chama precisa estar depois do
 * COMMIT do empréstimo. Com fila, só o id viaja na mensagem e o worker faz o
 * resto. Sem fila, ou com ela fora do ar, o envio acontece aqui mesmo: mais
 * lento, mas o leitor não fica sem comprovante.
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
    // o empréstimo já está gravado: a falha do e-mail vira aviso, não erro
    console.warn(`Comprovante do empréstimo ${loanId} não enviado: ${(error as Error).message}`);
  }
}

/**
 * A tarefa do lado do worker. Ao contrário de scheduleLoanReceipt, aqui a falha
 * sobe: sem o XACK, a fila entrega a mensagem de novo mais tarde.
 */
export function loanReceiptJob(sender: EmailSender | null = emailSender): Job<LoanReceiptTask> {
  return {
    stream: LOAN_RECEIPT_STREAM,
    async handle(task) {
      // a mensagem é dado externo, como o corpo de uma requisição: valida antes de usar
      if (!Number.isInteger(task?.loanId)) throw new Error("Tarefa de comprovante sem o id do empréstimo");
      const outcome = await sendLoanReceipt(task.loanId, sender);
      // só o id e o resultado: o e-mail do leitor é dado pessoal e não vai para o log
      console.log(`Comprovante do empréstimo ${task.loanId}: ${outcome}`);
    },
  };
}
