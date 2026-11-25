import type { Hono } from "hono";
import { inTransaction } from "../../../../infrastructure/transaction";
import { parsePositiveId, readJsonBody } from "../../../../shared/http";
import { circulationDependencies } from "../../infrastructure/dependencies";
import { loanJson } from "../../infrastructure/json";
import { scheduleLoanReceipt } from "../../infrastructure/loanReceiptJob";
import { RegisterLoan } from "./RegisterLoan";

/**
 * UC19: registra um empréstimo e pede o comprovante por e-mail. O COMMIT é o
 * fim do inTransaction, aqui na rota (o RegisterLoan só recebe a transação
 * pronta), então é aqui, e não no caso de uso, que o comprovante é pedido.
 */
export function registerRoutes(api: Hono): void {
  api.post("/emprestimos", async c => {
    const body = await readJsonBody(c);
    const readerId = parsePositiveId(body["leitorId"], "Leitor");
    const copyId = parsePositiveId(body["exemplarId"], "Exemplar");
    const loan = await inTransaction(tx => new RegisterLoan(...circulationDependencies(tx)).execute(readerId, copyId));
    // depois do COMMIT: o comprovante vai para a fila (ou sai na hora, sem fila),
    // e a resposta não espera o e-mail chegar
    await scheduleLoanReceipt(loan.id);
    return c.json(loanJson(loan), 201);
  });
}
