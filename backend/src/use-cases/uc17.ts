import { ReservarExemplar } from "../modules/circulacao/domain/ReservarExemplar";
import { corpoJson, idPositivo } from "../adapters/circulacaoHttp";
import { dependenciasCirculacao } from "../adapters/criarCirculacao";
import { sql } from "../infrastructure/postgres";
import { emTransacao } from "../infrastructure/transaction";
import { prepararCirculacao } from "../modules/circulacao/infrastructure/schema";
import { hoje } from "../modules/circulacao/domain/modelo";
import { InvalidInput } from "../shared/errors";
import type { CasoDeUso } from "./types";

export default {
  id: "uc17",
  preparar: () => prepararCirculacao(sql),
  registrar(api) {
    api.post("/reservas", async c => {
      const dados = await corpoJson(c);
      if (dados.dataReserva !== undefined && dados.dataReserva !== hoje()) {
        throw new InvalidInput("A reserva só pode ser feita para o dia corrente.");
      }
      const leitorId = idPositivo(dados.leitorId, "Leitor");
      const exemplarId = idPositivo(dados.exemplarId, "Exemplar");
      const reserva = await emTransacao(tx => new ReservarExemplar(...dependenciasCirculacao(tx)).executar(leitorId, exemplarId));
      return c.json(reserva, 201);
    });
  },
} satisfies CasoDeUso;
