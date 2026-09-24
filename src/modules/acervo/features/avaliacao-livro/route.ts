import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseNovaAvaliacao } from "./input";


export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/avaliacoes", async (contexto) => {
    const input = parseNovaAvaliacao(await contexto.req.json());
    const avaliacao = useCases.registrarAvaliacao.execute(input);
    contexto.header("Location", `/avaliacoes/${avaliacao.id}`);
    return contexto.json(avaliacao, 201);
  });
}
