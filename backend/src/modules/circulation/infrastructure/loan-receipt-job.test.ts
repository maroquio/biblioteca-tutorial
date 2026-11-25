import { afterAll, expect, test } from "bun:test";
import { api, testCopy } from "#tests/api";
import { testReader } from "#tests/reader-fixtures";
import { createMemorySender, emailSender, type MemorySender } from "../../../infrastructure/email";
import { sql } from "../../../infrastructure/postgres";
import { prepareGroups, workOnce } from "../../../infrastructure/queue";
import { createRedis } from "../../../infrastructure/redis";
import { inTransaction } from "../../../infrastructure/transaction";
import type { EmailSender } from "../../../shared/EmailSender";
import { circulationDependencies } from "./dependencies";
import { loanReceiptJob, scheduleLoanReceipt, sendLoanReceipt } from "./loanReceiptJob";
import { brazilianDate } from "./receiptEmail";
import { RegisterLoan } from "../features/register-loan/RegisterLoan";

/*
 * Testes de aceite da atividade: os nove estão habilitados, sem alterar as expectativas.
 */

// a suíte roda sem QUEUE_URL; aqui o cliente da fila é explícito, como nos testes da aula
const queue = createRedis(process.env.TEST_QUEUE_URL ?? "redis://fila:6379");
afterAll(() => queue.close());

// sem espera: cada volta do worker lê o que há na fila e devolve o controle ao teste
const workerOptions = { client: queue, consumer: "teste", blockMs: null, retryAfterMs: 300, maxDeliveries: 2 };

/** Um provedor de e-mail fora do ar. */
const failing: EmailSender = {
  async send() {
    throw new Error("provedor de e-mail fora do ar");
  },
};

/** Um empréstimo de um leitor novo, registrado pelo caso de uso, sem passar pela rota: o comprovante ainda não saiu. */
async function newLoan() {
  const reader = await testReader();
  const copy = await testCopy();
  const loan = await inTransaction((tx) => new RegisterLoan(...circulationDependencies(tx)).execute(reader.id, copy.id));
  return { reader, loan };
}

async function receiptSentAt(loanId: number): Promise<Date | null> {
  const [row] = await sql`SELECT comprovante_enviado_em AS "sentAt" FROM emprestimos WHERE id = ${loanId}`;
  return row.sentAt;
}

const sentTo = (sender: MemorySender, address: string) => sender.sent.filter((email) => email.to === address);

test("o stream dos comprovantes pertence à Circulação", () => {
  expect(loanReceiptJob(null).stream).toBe(`${process.env.REDIS_PREFIX ?? "biblioteca"}:circulacao:fila:comprovantes`);
});

test("UC19 API: sem fila, o comprovante sai na hora, para o e-mail do leitor", async () => {
  const reader = await testReader();
  const copy = await testCopy();
  const response = await api("POST", "/emprestimos", { leitorId: reader.id, exemplarId: copy.id });
  expect(response.status).toBe(201);
  const loan = await response.json();
  // a suíte manda os e-mails para a caixa de saída em memória (EMAIL_PROVIDER=memory)
  const received = sentTo(emailSender as MemorySender, reader.email);
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ toName: reader.nome, subject: `Comprovante de empréstimo: ${loan.livroTitulo}` });
  expect(received[0]!.text).toContain(`exemplar ${loan.numeroRegistro}`);
  expect(received[0]!.text).toContain(`Devolva até ${brazilianDate(loan.dataPrevistaDevolucao)}`);
  expect(await receiptSentAt(loan.id)).not.toBeNull();
});

test("UC19: com fila, a mensagem leva só o id do empréstimo, e o worker manda o comprovante", async () => {
  const { reader, loan } = await newLoan();
  const sender = createMemorySender();
  const job = loanReceiptJob(sender);
  await prepareGroups([job], queue);
  await scheduleLoanReceipt(loan.id, { client: queue, sender });
  // publicou e voltou: ninguém mandou nada ainda
  expect(sender.sent).toHaveLength(0);
  const [last] = await queue.send("XREVRANGE", [job.stream, "+", "-", "COUNT", "1"]) as [string, string[]][];
  const fields = last![1];
  expect(JSON.parse(fields[fields.indexOf("dados") + 1]!)).toEqual({ loanId: loan.id });
  await workOnce([job], workerOptions);
  expect(sentTo(sender, reader.email)).toHaveLength(1);
  expect(await receiptSentAt(loan.id)).not.toBeNull();
});

test("a mesma mensagem entregue duas vezes manda um e-mail só", async () => {
  const { reader, loan } = await newLoan();
  const sender = createMemorySender();
  const job = loanReceiptJob(sender);
  await job.handle({ loanId: loan.id });
  await job.handle({ loanId: loan.id });
  expect(sentTo(sender, reader.email)).toHaveLength(1);
  expect(await sendLoanReceipt(loan.id, sender)).toBe("já enviado");
});

test("o leitor trocou de e-mail antes do envio: o comprovante vai para o endereço atual", async () => {
  const { reader, loan } = await newLoan();
  const sender = createMemorySender();
  const job = loanReceiptJob(sender);
  await prepareGroups([job], queue);
  await scheduleLoanReceipt(loan.id, { client: queue, sender });
  const newEmail = `${crypto.randomUUID()}@exemplo.com`;
  const update = await api("PUT", `/leitores/${reader.id}`, { nome: reader.nome, cpf: reader.cpf, email: newEmail, telefone: reader.telefone });
  expect(update.status).toBe(200);
  await workOnce([job], workerOptions);
  expect(sentTo(sender, reader.email)).toHaveLength(0);
  expect(sentTo(sender, newEmail)).toHaveLength(1);
});

test("se o provedor falha, a tarefa lança e o comprovante não fica marcado; a nova tentativa envia", async () => {
  const { reader, loan } = await newLoan();
  await expect(loanReceiptJob(failing).handle({ loanId: loan.id })).rejects.toThrow("provedor de e-mail fora do ar");
  expect(await receiptSentAt(loan.id)).toBeNull();
  const sender = createMemorySender();
  await loanReceiptJob(sender).handle({ loanId: loan.id });
  expect(sentTo(sender, reader.email)).toHaveLength(1);
  expect(await receiptSentAt(loan.id)).not.toBeNull();
});

test("sem fila, o comprovante sai na hora; se o provedor falha, pedir o comprovante não lança", async () => {
  const { reader, loan } = await newLoan();
  await scheduleLoanReceipt(loan.id, { client: null, sender: failing });
  expect(await receiptSentAt(loan.id)).toBeNull();
  const sender = createMemorySender();
  await scheduleLoanReceipt(loan.id, { client: null, sender });
  expect(sentTo(sender, reader.email)).toHaveLength(1);
});

test("empréstimo inexistente não manda nada nem lança; mensagem sem o id falha", async () => {
  const sender = createMemorySender();
  expect(await sendLoanReceipt(2147483647, sender)).toBe("empréstimo não encontrado");
  await loanReceiptJob(sender).handle({ loanId: 2147483647 });
  await expect(loanReceiptJob(sender).handle({ loanId: "7" } as never)).rejects.toThrow("sem o id do empréstimo");
  await expect(loanReceiptJob(sender).handle(null as never)).rejects.toThrow("sem o id do empréstimo");
  expect(sender.sent).toHaveLength(0);
});

test("sem remetente configurado, nada é enviado nem marcado", async () => {
  const { loan } = await newLoan();
  expect(await sendLoanReceipt(loan.id, null)).toBe("sem remetente");
  await loanReceiptJob(null).handle({ loanId: loan.id });
  expect(await receiptSentAt(loan.id)).toBeNull();
});


/* Passo 07 — discussão
 * 1. Enviar antes de marcar permite repetição se o processo morrer antes do
 * COMMIT; marcar antes pode perder o envio. Para comprovante, repetição é
 * preferível à ausência. Para cobrança, usar idempotência no provedor.
 * 2. Uma queda entre o COMMIT do UC19 e o XADD pode perder a tarefa. Um outbox
 * transacional resolve a lacuna. Uma varredura pode republicar IDs sem marca,
 * mas deve limitar-se aos empréstimos elegíveis criados após a implantação.
 * 3. SELECT FOR UPDATE serializa os envios do mesmo empréstimo. A segunda
 * transação espera e verifica a marca. O timeout de 5 s reduz reentregas
 * concorrentes (10 s). Marcar antes com UPDATE condicional exige desfazer a
 * marca na falha e pode perder o envio se o processo morrer.
 * 4. Após restaurar o provedor, republicar os IDs válidos da fila de mortas
 * no stream original, conferindo o resultado antes de remover os registros.
 * A marca evita reenviar os já concluídos. Corrigir ou descartar mensagens
 * inválidas como loanId string. Alertar a operação sobre lag e fila de mortas.
 * 5. O endereço passa pelo PostgreSQL, pela porta de consulta e pelo provedor
 * de e-mail; pode ficar no Mailpit, no provedor real e em backups. A fila e
 * a fila de mortas carregam apenas o ID como payload, reduzindo exposição de
 * dados pessoais. Mensagens de erro de provedores também exigem cuidado.
 */
