import type { CasoDeUso } from "./types";
import { excluirExemplar } from "../modules/acervo/excluirExemplar";
import { identificador } from "../modules/acervo/domain/dadosDoLivro";
import { integracaoDoCatalogo } from "../adapters/acervoIntegracao";

export default {
  id: "uc16",
  registrar(api) {
    api.delete("/exemplares/:id", async (c) => {
      await excluirExemplar(identificador(c.req.param("id")), integracaoDoCatalogo);
      return c.body(null, 204);
    });
  },
} satisfies CasoDeUso;
