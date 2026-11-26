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
 * Passo 07: respostas para discussão
 *
 * 1. Marcar antes ou depois
 *    Aqui a marca vem depois do envio. Se o processo morrer entre o envio e o
 *    UPDATE, a coluna fica nula, a mensagem não recebe XACK e volta 10 s depois:
 *    o leitor recebe o comprovante duas vezes. Na ordem inversa (marca antes,
 *    desfaz se o envio falhar), morrer entre a marca e o envio deixa a coluna
 *    preenchida sem e-mail nenhum: a nova entrega encontra "já enviado" e o
 *    leitor nunca recebe. Para um comprovante, um e-mail repetido é bem menos
 *    grave do que nenhum. Numa cobrança no cartão a resposta muda: cobrar duas
 *    vezes é pior do que não cobrar, então valeria marcar antes (ou, melhor,
 *    mandar uma chave de idempotência para o provedor do pagamento, para ele
 *    mesmo recusar a segunda cobrança).
 *
 * 2. O outbox
 *    Se a aplicação cair entre o COMMIT e o XADD, o empréstimo existe e a tarefa
 *    nunca foi publicada: o comprovante não sai, e ninguém fica sabendo. A coluna
 *    nula ajuda a achar esses empréstimos, mas não basta sozinha, porque ela
 *    também é nula enquanto a mensagem está na fila esperando. A varredura
 *    procuraria empréstimos com comprovante_enviado_em nula e registrados há mais
 *    de alguns minutos, e republicaria o { loanId } de cada um (como o envio já é
 *    "uma vez só", republicar algo que estava na fila não manda e-mail repetido).
 *    O cuidado com os empréstimos antigos, de antes desta atividade, é não mandar
 *    comprovante para todos eles de uma vez: a varredura precisa de uma data de
 *    corte (só empréstimos registrados depois que o comprovante passou a existir),
 *    ou esses antigos precisam ser marcados de alguma forma na migração. Com um
 *    outbox de verdade, a tarefa seria gravada numa tabela dentro da mesma
 *    transação do empréstimo, e um processo separado publicaria na fila.
 *
 * 3. Dois workers, a mesma mensagem
 *    Na minha implementação, nada impede totalmente: se o provedor demorar mais
 *    de 10 s, a mensagem volta para outro worker, que lê a coluna ainda nula e
 *    envia também. O que segura isso é o adaptador desistir em 5 s, antes dos
 *    10 s do retryAfterMs: o primeiro worker falha (e não marca) antes de a
 *    mensagem voltar, então não há dois envios ao mesmo tempo. Um UPDATE ...
 *    WHERE comprovante_enviado_em IS NULL RETURNING id antes do envio resolveria
 *    a corrida, porque só um worker conseguiria "pegar" o empréstimo. O custo é
 *    o do item 1: se o envio falhar, a coluna precisa ser zerada de volta, e se o
 *    processo morrer antes disso o comprovante fica marcado sem ter saído. Daria
 *    para usar uma coluna separada de "enviando desde" com prazo, em vez da
 *    própria comprovante_enviado_em.
 *
 * 4. A fila de mortas
 *    Para reprocessar, eu leria as mensagens de ...:mortas com XRANGE, publicaria
 *    o campo dados de cada uma de novo no stream dos comprovantes (XADD) e só
 *    depois apagaria da fila de mortas (XDEL). É seguro porque o envio confere a
 *    coluna antes de mandar: se algum desses comprovantes já tiver saído, a tarefa
 *    devolve "já enviado". A mensagem {"loanId":"7"} não faz sentido reprocessar:
 *    ela falhou por ser inválida, não por causa do Mailpit, e falharia de novo; o
 *    certo é descobrir quem publicou isso e corrigir lá. Quem cuida do sistema
 *    deveria ser avisado quando a fila de mortas cresce (e quando o lag sobe),
 *    por uma métrica com alerta, olhando o XLEN da fila de mortas e o lag do
 *    XINFO GROUPS, em vez de esperar um leitor reclamar.
 *
 * 5. O e-mail é dado pessoal
 *    Como a mensagem leva só o id, o endereço não passa pela fila nem pela fila
 *    de mortas. Ele passa pela consulta ao Postgres (tabela leitores), pela
 *    memória do worker na hora do envio, pela requisição ao Mailpit e fica
 *    guardado no Mailpit (até o contêiner ser recriado). Num provedor de verdade,
 *    o e-mail fica nos registros e no histórico de envios do provedor, às vezes
 *    por muito tempo, e nos backups do banco. Além de evitar o endereço velho, a
 *    mensagem só com o id protege contra vazar dado pessoal pela fila: ela tem
 *    volume, guarda até 10 mil mensagens e a fila de mortas guarda as que
 *    falharam, e qualquer um com acesso ao Redis leria os endereços. Também evita
 *    que um pedido de exclusão (LGPD) precise limpar a fila.
 */
