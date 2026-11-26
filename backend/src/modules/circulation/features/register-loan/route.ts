import type { Hono } from "hono";
import { inTransaction } from "../../../../infrastructure/transaction";
import { parsePositiveId, readJsonBody } from "../../../../shared/http";
import { circulationDependencies } from "../../infrastructure/dependencies";
import { loanJson } from "../../infrastructure/json";
import { scheduleLoanReceipt } from "../../infrastructure/loanReceiptJob";
import { RegisterLoan } from "./RegisterLoan";

/** UC19: registra um empréstimo e pede o comprovante ao leitor. */
export function registerRoutes(api: Hono): void {
  api.post("/emprestimos", async c => {
    const body = await readJsonBody(c);
    const readerId = parsePositiveId(body["leitorId"], "Leitor");
    const copyId = parsePositiveId(body["exemplarId"], "Exemplar");
    const loan = await inTransaction(tx => new RegisterLoan(...circulationDependencies(tx)).execute(readerId, copyId));
    // a rota é quem faz o COMMIT: só depois dele o empréstimo existe para quem envia
    await scheduleLoanReceipt(loan.id);
    return c.json(loanJson(loan), 201);
  });
}
