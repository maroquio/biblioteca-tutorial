import { createDb } from "./db";
import { DomainError, InvalidValue } from "./domain/errors";
import { InvalidInput, NotFound, RuleConflict } from "./errors";
import { match, type Route } from "./router";
import { livroRoutes } from "./routes/livros";

createDb();

const routes: Route[] = [
  {
    method: "GET",
    pattern: "/",
    handler: () => Response.json({ message: "API da Biblioteca" }),
  },
  ...livroRoutes,
];

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

const server = Bun.serve({
  port: 3000,

  async fetch(request) {
    const url = new URL(request.url);

    try {
      for (const route of routes) {
        if (route.method !== request.method) continue;

        const params = match(route.pattern, url.pathname);
        if (params) return await route.handler(request, params);
      }

      return Response.json({ error: "Recurso não encontrado" }, { status: 404 });
    } catch (error) {
      return errorResponse(error);
    }
  },
});

console.log(`Servidor executando em http://localhost:${server.port}`);
