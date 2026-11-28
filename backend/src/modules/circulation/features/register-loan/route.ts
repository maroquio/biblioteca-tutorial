import type { Hono } from "hono";
import { inTransaction } from "../../../../infrastructure/transaction";
import { parsePositiveId, readJsonBody } from "../../../../shared/http";
import { circulationDependencies } from "../../infrastructure/dependencies";
import { loanJson } from "../../infrastructure/json";
import { scheduleLoanReceipt } from "../../infrastructure/loanReceiptJob";
import { RegisterLoan } from "./RegisterLoan";

/**
 * UC19: registra um empréstimo e pede o comprovante. Quem faz o COMMIT é esta
 * rota, ao fim do inTransaction: o comprovante só é pedido depois dele, senão o
 * envio leria o empréstimo por outra conexão e não o encontraria.
 */
export function registerRoutes(api: Hono): void {
  api.post("/emprestimos", async c => {
    const body = await readJsonBody(c);
    const readerId = parsePositiveId(body["leitorId"], "Leitor");
    const copyId = parsePositiveId(body["exemplarId"], "Exemplar");
    const loan = await inTransaction(tx => new RegisterLoan(...circulationDependencies(tx)).execute(readerId, copyId));
    // depois do COMMIT: com fila, só publica e volta; sem fila, envia aqui mesmo
    await scheduleLoanReceipt(loan.id);
    return c.json(loanJson(loan), 201);
  });
}
