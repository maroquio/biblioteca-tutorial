import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseNovaSolicitacao } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/solicitacoes", async (contexto: { req: { json: () => unknown; }; header: (arg0: string, arg1: string) => void; json: (arg0: any, arg1: number) => any; }) => {
    const input = parseNovaSolicitacao(await contexto.req.json());
    const solicitacao = useCases.registrarSolicitacao.execute(input);
    contexto.header("Location", `/solicitacoes/${solicitacao.id}`);
    return contexto.json(solicitacao, 201);
  });
}