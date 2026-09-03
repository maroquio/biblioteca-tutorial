import { Hono } from "hono";
import type { UseCases } from "./composition";
import { DomainError, InvalidValue } from "./shared/domain-errors";
import { register as registerBuscarLivro } from "./modules/acervo/features/buscar-livro/route";
import { register as registerCadastrarLivro } from "./modules/acervo/features/cadastrar-livro/route";
import { InvalidInput, NotFound, RuleConflict } from "./shared/errors";

function errorResponse(error: unknown): Response {
  if (error instanceof InvalidInput || error instanceof InvalidValue) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof NotFound) {
    return Response.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof RuleConflict || error instanceof DomainError) {
    return Response.json({ error: error.message }, { status: 409 });
  }

  console.error(error);

  return Response.json({ error: "Erro interno" }, { status: 500 });
}

export function createServer(useCases: UseCases, porta = 3000) {
  const app = new Hono();

  app.get("/", (contexto) => contexto.json({ message: "API da Biblioteca" }));

  registerCadastrarLivro(app, useCases);
  registerBuscarLivro(app, useCases);

  app.notFound((contexto) =>
    contexto.json({ error: "Recurso não encontrado" }, 404),
  );

  app.onError((error) => errorResponse(error));

  return Bun.serve({ port: porta, fetch: app.fetch });
}
