import type { Hono } from "hono";
import type { UseCases } from "../../../../composition";
import { parsePedidoDeBaixa } from "./input";

export function register(routes: Hono, useCases: UseCases): void {
  routes.post("/livros/:numeroRegistro/baixa", async (contexto) => {
    const livro = useCases.darBaixa.execute(
      parsePedidoDeBaixa(contexto.req.param(), await contexto.req.json()),
    );

    return contexto.json(livro);
  });
}