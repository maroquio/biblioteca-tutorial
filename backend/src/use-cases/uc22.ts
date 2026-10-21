import { ConsultarReservas } from "../modules/circulacao/domain/ConsultarReservas";
import { filtroId, idPositivo } from "../adapters/circulacaoHttp";
import { dependenciasCirculacao } from "../adapters/criarCirculacao";
import { sql } from "../infrastructure/postgres";
import type { CasoDeUso } from "./types";

export default {
  id: "uc22",
  registrar(api) {
    api.get("/reservas", async c => c.json(await new ConsultarReservas(...dependenciasCirculacao(sql)).executar({
      leitorId: filtroId(c.req.query("leitorId")), exemplarId: filtroId(c.req.query("exemplarId")),
      situacao: c.req.query("situacao"),
    })));
    api.get("/reservas/:id", async c => c.json(await new ConsultarReservas(...dependenciasCirculacao(sql)).obter(idPositivo(c.req.param("id")))));
  },
} satisfies CasoDeUso;
