import type { Hono } from "hono";
import { inTransaction } from "../../../../infrastructure/transaction";
import { parsePositiveId, readJsonBody } from "../../../../shared/http";
import { circulationDependencies } from "../../infrastructure/dependencies";
import { loanJson } from "../../infrastructure/json";
import { RegisterLoan } from "./RegisterLoan";
import { scheduleLoanReceipt } from "../../infrastructure/loanReceiptJob";

/**
 * UC19: registra um empréstimo. O comprovante é pedido depois do COMMIT, que
 * acontece quando o inTransaction retorna: antes disso, nem o worker nem o
 * envio na hora enxergariam o empréstimo.
 */
export function registerRoutes(api: Hono): void {
  api.post("/emprestimos", async c => {
    const body = await readJsonBody(c);
    const readerId = parsePositiveId(body["leitorId"], "Leitor");
    const copyId = parsePositiveId(body["exemplarId"], "Exemplar");
    const loan = await inTransaction(tx => new RegisterLoan(...circulationDependencies(tx)).execute(readerId, copyId));
    await scheduleLoanReceipt(loan.id);
    return c.json(loanJson(loan), 201);
  });
}
