import type { RedisClient, SQL } from "bun";
import { emailSender } from "../../../infrastructure/email";
import { sql } from "../../../infrastructure/postgres";
import { enqueue, queue, type Job } from "../../../infrastructure/queue";
import { redisKey } from "../../../infrastructure/redis";
import { PostgresCirculationLookup } from "../../../integration/PostgresCirculationLookup";
import type { EmailSender } from "../../../shared/EmailSender";
import type { CirculationLookup } from "../domain/CirculationLookup";
import { receiptEmail } from "./receiptEmail";

/** O stream dos comprovantes. O primeiro trecho diz o dono, como toda chave do Redis. */
export const LOAN_RECEIPT_STREAM = redisKey("circulacao", "fila", "comprovantes");

/** A mensagem leva só o id do empréstimo: o resto, o worker lê na hora de enviar. */
export type LoanReceiptTask = { loanId: number };

/** O que aconteceu com um pedido de comprovante. O worker escreve isso no log. */
export type ReceiptOutcome = "enviado" | "já enviado" | "empréstimo não encontrado" | "sem remetente";

/** O que o comprovante precisa do empréstimo: a quem ele pertence, de quando e se já saiu. */
type LoanRow = { id: number; readerId: number; copyId: number; loanedOn: string; dueOn: string; sentAt: Date | null };

/** A porta da Circulação: o e-mail mora em Leitores, e só a porta atravessa a fronteira. */
const lookup: CirculationLookup = new PostgresCirculationLookup(sql);

/**
 * Manda o comprovante do empréstimo ao leitor, uma vez só. Lança quando o envio
 * falha: no worker, sem o XACK, a fila entrega a mensagem de novo mais tarde.
 *
 * A marca vem DEPOIS do envio, e só grava quando a coluna ainda está nula: um
 * envio que falhou não deixa o comprovante como enviado, e a reentrega tenta de
 * novo. O preço é que uma queda entre o envio e a marca pode repetir o e-mail;
 * entre repetir e não mandar, o comprovante prefere repetir.
 */
export async function sendLoanReceipt(loanId: number, sender: EmailSender | null = emailSender): Promise<ReceiptOutcome> {
  if (!sender) return "sem remetente";
  const [loan] = await sql<LoanRow[]>`SELECT id, leitor_id AS "readerId", exemplar_id AS "copyId",
    data_emprestimo AS "loanedOn", data_prevista_devolucao AS "dueOn",
    comprovante_enviado_em AS "sentAt" FROM emprestimos WHERE id = ${loanId}`;
  if (!loan) return "empréstimo não encontrado";
  if (loan.sentAt) return "já enviado";
  // nome e e-mail ATUAIS: o leitor pode ter corrigido o endereço enquanto a mensagem esperava na fila
  const [reader, copy] = await Promise.all([lookup.reader(loan.readerId), lookup.copy(loan.copyId)]);
  if (!reader) return "empréstimo não encontrado";
  await sender.send(receiptEmail({
    loanId: loan.id,
    readerName: reader.name,
    readerEmail: reader.email,
    bookTitle: copy?.bookTitle ?? "",
    registrationNumber: copy?.registrationNumber ?? "",
    loanedOn: loan.loanedOn,
    dueOn: loan.dueOn,
  }));
  await sql`UPDATE emprestimos SET comprovante_enviado_em = now() WHERE id = ${loan.id} AND comprovante_enviado_em IS NULL`;
  return "enviado";
}

/**
 * UC19: pede o comprovante e volta na hora. Quem chama precisa estar depois do
 * COMMIT do empréstimo: sem fila, o envio na hora lê o empréstimo por outra
 * conexão, que ainda não enxergaria o INSERT sem COMMIT.
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
    // o empréstimo já está gravado: sem fila, o comprovante não pode virar erro da requisição
    console.warn(`Comprovante do empréstimo ${loanId} não pôde ser enviado na hora: ${(error as Error).message}`);
  }
}

/**
 * A tarefa do lado do worker, como bookIndexJob. A falha sobe: sem XACK, a fila
 * entrega a mensagem de novo.
 */
export function loanReceiptJob(sender: EmailSender | null = emailSender): Job<LoanReceiptTask> {
  return {
    stream: LOAN_RECEIPT_STREAM,
    async handle(task) {
      if (!Number.isSafeInteger(task?.loanId)) {
        throw new Error("Tarefa de comprovante sem o id do empréstimo");
      }
      const outcome = await sendLoanReceipt(task.loanId, sender);
      // o id do empréstimo, nunca o e-mail do leitor: endereço é dado pessoal
      console.log(`Comprovante do empréstimo ${task.loanId}: ${outcome}`);
    },
  };
}
