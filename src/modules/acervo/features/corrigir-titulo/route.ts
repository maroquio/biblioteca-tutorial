import type { UseCases } from "../../../../composition";
import type { TituloCorrigidoJson } from "../../output";
import { parseCorrecaoDeTitulo } from "./input";
import type { Hono } from "hono";



export function register(routes: Hono, useCases: UseCases): void {
  routes.patch("/livros/:id/titulo", async (contexto: { req: { param: () => { id?: string; }; json: () => unknown; }; json: (arg0: TituloCorrigidoJson, arg1: number) => any; }) => {
    const input = parseCorrecaoDeTitulo(
      contexto.req.param(),
      await contexto.req.json(),
    );
    return contexto.json(useCases.corrigirTitulo.execute(input), 200);
  });
}