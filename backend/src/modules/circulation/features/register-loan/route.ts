import type { Hono } from "hono";
import { inTransaction } from "../../../../infrastructure/transaction";
import { parsePositiveId, readJsonBody } from "../../../../shared/http";
import { circulationDependencies } from "../../infrastructure/dependencies";
import { loanJson } from "../../infrastructure/json";
import { scheduleLoanReceipt } from "../../infrastructure/loanReceiptJob";
import { RegisterLoan } from "./RegisterLoan";

/** UC19: registra um empréstimo. O comprovante é pedido depois do COMMIT, não dentro da transação. */
export function registerRoutes(api: Hono): void {
  api.post("/emprestimos", async c => {
    const body = await readJsonBody(c);
    const readerId = parsePositiveId(body["leitorId"], "Leitor");
    const copyId = parsePositiveId(body["exemplarId"], "Exemplar");
    const loan = await inTransaction(tx => new RegisterLoan(...circulationDependencies(tx)).execute(readerId, copyId));
    // inTransaction só volta depois do COMMIT: o worker já enxerga o empréstimo, e a resposta não espera o e-mail
    await scheduleLoanReceipt(loan.id);
    return c.json(loanJson(loan), 201);
  });
}
