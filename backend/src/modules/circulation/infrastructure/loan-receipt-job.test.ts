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
 * Para discutir (passo 07 da atividade)
 *
 * 1. Marcar antes ou depois.
 * Aqui a marca vem depois do envio. Se o processo morrer entre o envio e a marca,
 * o leitor já recebeu o e-mail, mas a mensagem ficou sem XACK e a coluna nula:
 * 10 s depois a fila entrega de novo, e ele recebe um segundo comprovante. Na
 * ordem inversa, a marca fica gravada, o e-mail não sai, e a nova entrega
 * encontra "já enviado": o leitor fica sem comprovante nenhum.
 * Para um comprovante, nenhum é pior que repetido. O repetido incomoda, mas o
 * leitor tem a prova do empréstimo; sem ele, não tem nada e ninguém percebe.
 * Numa cobrança no cartão a conta inverte: cobrar duas vezes é dano real. Aí eu
 * marcaria antes, mandaria uma chave de idempotência para o provedor de
 * pagamento (que recusa a segunda cobrança com a mesma chave) e trataria a
 * cobrança que faltou numa conciliação.
 *
 * 2. O outbox.
 * Se a aplicação cair entre o COMMIT e o XADD, o empréstimo existe e a mensagem
 * não. O comprovante nunca sai, e nada avisa. A coluna nula ajuda a achar esses
 * casos: uma varredura periódica busca os empréstimos com comprovante_enviado_em
 * nula e republica { loanId } de cada um. Republicar é seguro porque o envio
 * confere a coluna antes de mandar.
 * O cuidado são os empréstimos registrados antes desta atividade, que também têm
 * a coluna nula: sem uma data de corte (a do deploy, por exemplo), a varredura
 * mandaria comprovantes de empréstimos antigos, até de livros já devolvidos.
 * Outra saída é preencher a coluna desses antigos na própria migração. Também
 * vale esperar alguns minutos antes de considerar um empréstimo esquecido, para
 * não republicar o que ainda está na fila. O outbox resolve na raiz: a tarefa é
 * gravada numa tabela na mesma transação do empréstimo, e um publicador faz o
 * XADD depois.
 *
 * 3. Dois workers, a mesma mensagem.
 * Enquanto o primeiro worker espera o provedor, a coluna continua nula. Se a
 * espera passar de 10 s, o segundo worker reivindica a mensagem (XCLAIM), lê a
 * coluna nula e envia também: dois e-mails. O que impede isso aqui é o adaptador
 * desistir em 5 s, metade do tempo de nova entrega: o primeiro worker falha e
 * solta a mensagem antes de ela poder ser reivindicada. Ainda sobra um caso: o
 * provedor aceitou o e-mail, mas a resposta chegou depois dos 5 s; nós achamos
 * que falhou, e a nova tentativa manda de novo.
 * Um UPDATE ... WHERE comprovante_enviado_em IS NULL RETURNING id antes do envio
 * funciona como trava: só um worker ganha a linha. O custo aparece na falha: é
 * preciso desfazer a marca quando o envio falha, e se o processo morrer entre a
 * trava e o envio, a marca fica e o comprovante nunca sai. É o risco do "marcar
 * antes" do item 1. Uma coluna separada, como enviando_desde com prazo, daria a
 * trava sem perder o comprovante.
 *
 * 4. A fila de mortas.
 * Eu leria a fila de mortas com XRANGE, publicaria de novo o campo dados de cada
 * entrada no stream principal e apagaria a entrada (XDEL). É seguro porque o
 * envio é idempotente: se algum comprovante tiver saído, a tarefa devolve "já
 * enviado". A mensagem {"loanId":"7"} não deve voltar: o id é texto, e ela falha
 * igual nas cinco tentativas. O certo é corrigir quem publicou e descartá-la,
 * registrando o motivo. Quem opera o sistema precisa saber que a fila de mortas
 * cresceu: uma checagem periódica do XLEN dela e do lag do grupo, com alerta
 * quando passa de zero, e não só o aviso no log, que ninguém lê a tempo.
 *
 * 5. O e-mail é dado pessoal.
 * O endereço passa pela tabela leitores, pela memória do worker na hora do envio,
 * pela requisição ao Mailpit (que guarda as mensagens até ser reiniciado) e, num
 * provedor de verdade, pelos registros e cópias dele, além da caixa do leitor e
 * dos backups do Postgres. Ele não passa pela fila nem pela fila de mortas,
 * porque a mensagem leva só o id. Isso protege bastante: a fila tem volume e a de
 * mortas guarda mensagens por tempo indefinido, então quem lê o Redis não vê
 * dado pessoal, e atender a um pedido de exclusão do leitor não exige vasculhar
 * a fila.
 */
