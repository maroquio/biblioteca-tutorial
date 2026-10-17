import type { CasoDeUso } from "./types";
import { atualizarExemplar } from "../modules/acervo/atualizarExemplar";
import { identificador } from "../modules/acervo/domain/dadosDoLivro";
import { integracaoDoCatalogo } from "../adapters/acervoIntegracao";

export default {
  id: "uc15",
  registrar(api) {
    api.put("/exemplares/:id", async (c) => c.json(await atualizarExemplar(identificador(c.req.param("id")), await c.req.json(), integracaoDoCatalogo)));
  },
} satisfies CasoDeUso;
