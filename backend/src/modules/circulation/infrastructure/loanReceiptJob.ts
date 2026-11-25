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

type LoanForReceipt = { id: number; readerId: number; copyId: number; loanedOn: string; dueOn: string; receiptSentAt: Date | null };

/**
 * Manda o comprovante do empréstimo ao leitor, uma vez só. Lança quando o envio
 * falha: no worker, sem o XACK, a fila entrega a mensagem de novo mais tarde.
 *
 * A fila entrega cada mensagem pelo menos uma vez, e um e-mail não se desfaz:
 * comprovante_enviado_em é a memória do que já saiu. Preenchida, a tarefa devolve
 * "já enviado" e não manda nada.
 *
 * A marca vem DEPOIS do envio. Se o processo morrer entre o envio e a marca, a
 * mensagem volta e o leitor recebe o comprovante duas vezes; na ordem inversa, o
 * leitor poderia ficar sem nenhum. Para um comprovante, repetido é melhor que
 * nenhum. E, como a marca só é gravada depois que o envio deu certo, um envio que
 * falhou nunca deixa o comprovante marcado como enviado.
 */
export async function sendLoanReceipt(loanId: number, sender: EmailSender | null = emailSender): Promise<ReceiptOutcome> {
  if (!sender) return "sem remetente";

  // Serializa entregas concorrentes do mesmo empréstimo, inclusive entre workers.
  return await sql.begin(async (tx): Promise<ReceiptOutcome> => {
    const [loan] = await tx<LoanForReceipt[]>`
      SELECT id, leitor_id AS "readerId", exemplar_id AS "copyId",
        data_emprestimo AS "loanedOn", data_prevista_devolucao AS "dueOn",
        comprovante_enviado_em AS "receiptSentAt"
      FROM emprestimos WHERE id = ${loanId} FOR UPDATE
    `;
    if (!loan) return "empréstimo não encontrado";
    if (loan.receiptSentAt) return "já enviado";

    // o nome e o e-mail do leitor são lidos agora, e não na hora de publicar: se ele
    // corrigiu o endereço enquanto a mensagem esperava na fila, vale o endereço novo.
    // O e-mail mora em Leitores, então chega pela porta, e não por um SELECT em leitores
    const [, lookup] = circulationDependencies(tx);
    const [reader, copy] = await Promise.all([lookup.reader(loan.readerId), lookup.copy(loan.copyId)]);
    if (!reader || !copy) throw new Error(`Leitor ou exemplar do empréstimo ${loanId} não encontrado`);

    await sender.send(receiptEmail({
      loanId: loan.id,
      readerName: reader.name,
      readerEmail: reader.email,
      bookTitle: copy.bookTitle,
      registrationNumber: copy.registrationNumber,
      loanedOn: loan.loanedOn,
      dueOn: loan.dueOn,
    }));

    // A linha continua bloqueada até o COMMIT: outra entrega só envia se a marca continuar nula.
    await tx`UPDATE emprestimos SET comprovante_enviado_em = now() WHERE id = ${loanId} AND comprovante_enviado_em IS NULL`;
    return "enviado";
  }) as ReceiptOutcome;
}

/**
 * UC19: pede o comprovante e volta na hora. Quem chama precisa estar depois do
 * COMMIT do empréstimo: antes dele, o worker (ou o envio na hora, por outra
 * conexão) não enxergaria o empréstimo, e uma transação desfeita deixaria na fila
 * o comprovante de um empréstimo que não existe.
 *
 * Sem fila, ou com ela fora do ar, envia aqui mesmo: mais devagar, mas o leitor
 * recebe o comprovante. Se esse envio falhar, vira um aviso no log: o empréstimo
 * já está gravado, e o comprovante não pode transformá-lo num erro.
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
    console.warn(`Comprovante do empréstimo ${loanId} não enviado: ${(error as Error).message}`);
  }
}

/** A tarefa do lado do worker. Ao contrário de scheduleLoanReceipt, aqui a falha sobe: a fila tenta de novo. */
export function loanReceiptJob(sender: EmailSender | null = emailSender): Job<LoanReceiptTask> {
  return {
    stream: LOAN_RECEIPT_STREAM,
    async handle(task) {
      // a mensagem é dado externo, como o corpo de uma requisição
      if (!Number.isSafeInteger(task?.loanId) || task.loanId <= 0 || task.loanId > 2147483647) throw new Error("Tarefa de comprovante sem o id do empréstimo");
      const outcome = await sendLoanReceipt(task.loanId, sender);
      // o log leva o id do empréstimo, nunca o e-mail do leitor: é dado pessoal
      console.log(`Comprovante do empréstimo ${task.loanId}: ${outcome}`);
    },
  };
}
