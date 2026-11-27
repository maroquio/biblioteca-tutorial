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
 * Testes de aceite da atividade. Cada um começa como test.todo: o bun test lista,
 * mas não executa. Quando implementar a parte que um teste cobre, troque
 * test.todo por test e rode a suíte. Não altere o que os testes esperam.
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

/*
 * Passo 07 — Para discutir:
 *
 * 1. Marcar antes ou depois:
 *    Nesta implementação, comprovante_enviado_em é gravada DEPOIS de sender.send.
 *    Se o processo morrer entre o envio e o UPDATE, a fila reentrega a mensagem e o
 *    leitor pode receber um comprovante duplicado. Na ordem inversa (marcar antes e
 *    limpar no catch), se o processo morrer entre o UPDATE e o envio, o leitor nunca
 *    recebe o comprovante. Para um comprovante informativo, um e-mail repetido é bem
 *    menos grave do que não receber nenhum; já em uma cobrança no cartão, duplicar é
 *    crítico e a resposta mudaria (exigiria idempotency key no provedor / reserva prévia).
 *
 * 2. O outbox:
 *    Se a aplicação cair entre o COMMIT do empréstimo e o XADD, o empréstimo existe no
 *    Postgres com comprovante_enviado_em = NULL, mas nenhuma tarefa entrou na fila.
 *    Uma varredura periódica (reconciliação) pode buscar empréstimos com
 *    comprovante_enviado_em IS NULL e republicá-los, porém precisa filtrar por uma data
 *    de corte (ex.: criados a partir da ativação da funcionalidade ou janela recente)
 *    para não disparar comprovantes antigos de empréstimos registrados antes desta coluna.
 *
 * 3. Dois workers, a mesma mensagem:
 *    Se o provedor demorar mais de 10 s (retryAfterMs), o XCLAIM pode entregar a mesma
 *    mensagem a um segundo worker enquanto o primeiro ainda aguarda resposta; sem
 *    controle otimista, ambos enviariam o e-mail. O timeout de 5 s do adaptador do
 *    Mailpit existe justamente para desistir antes dos 10 s. Um UPDATE condicional
 *    (WHERE comprovante_enviado_em IS NULL RETURNING id) antes do envio evitaria o
 *    envio simultâneo, ao custo de precisar desfazer a marca quando o envio falhar
 *    (e de ainda perder o envio se o processo morrer antes de desfazer).
 *
 * 4. A fila de mortas:
 *    As mensagens de falha temporária do Mailpit podem ser reprocessadas republicando
 *    o payload original no stream principal (XADD) e removendo-as da DLQ; é seguro
 *    porque sendLoanReceipt é idempotente via comprovante_enviado_em. Já uma mensagem
 *    malformada como {"loanId":"7"} nunca vai passar na validação, então reprocessá-la
 *    sem correção só a devolveria para as mortas. O time de operação/desenvolvimento
 *    deve ser alertado por métricas/monitoramento do tamanho da DLQ e do lag do grupo.
 *
 * 5. O e-mail é dado pessoal:
 *    O endereço passa pelo Postgres (leitores), pela memória do worker ao montar o
 *    e-mail, pelo tráfego HTTP até o provedor (Mailpit/SES/etc.), pelos registros de
 *    entrega do provedor e pelos backups do banco. Enviar apenas { loanId } na mensagem
 *    evita espalhar PII (e-mail, nome) nos streams do Redis, na fila de mortas e em
 *    eventuais logs/inspeções de fila.
 */
