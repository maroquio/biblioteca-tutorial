import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parseNovoEmprestimo } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/emprestimos", async (contexto) => {
    const emprestimo = useCases.emprestarLivro.execute(
      parseNovoEmprestimo(await contexto.req.json()),
    );

    return contexto.json(emprestimo, 201);
  });
}
