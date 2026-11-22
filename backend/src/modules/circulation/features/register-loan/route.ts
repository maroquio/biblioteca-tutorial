import type { Hono } from "hono";
import { inTransaction } from "../../../../infrastructure/transaction";
import { parsePositiveId, readJsonBody } from "../../../../shared/http";
import { circulationDependencies } from "../../infrastructure/dependencies";
import { loanJson } from "../../infrastructure/json";
import { scheduleLoanReceipt } from "../../infrastructure/loanReceiptJob";
import { RegisterLoan } from "./RegisterLoan";

/**
 * UC19: registra um empréstimo. O RegisterLoan recebe a transação pronta e não
 * sabe quando o COMMIT acontece: quem decide é esta rota, no inTransaction.
 */
export function registerRoutes(api: Hono): void {
  api.post("/emprestimos", async c => {
    const body = await readJsonBody(c);
    const readerId = parsePositiveId(body["leitorId"], "Leitor");
    const copyId = parsePositiveId(body["exemplarId"], "Exemplar");
    const loan = await inTransaction(tx => new RegisterLoan(...circulationDependencies(tx)).execute(readerId, copyId));
    // depois do COMMIT: antes dele, quem fosse enviar o comprovante não acharia o empréstimo
    await scheduleLoanReceipt(loan.id);
    return c.json(loanJson(loan), 201);
  });
}
