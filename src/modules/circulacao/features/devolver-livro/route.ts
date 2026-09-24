import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseEmprestimoId } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/emprestimos/:id/devolucao", (contexto) =>
    contexto.json(
      useCases.devolverLivro.execute(parseEmprestimoId(contexto.req.param())),
    ),
  );
}
