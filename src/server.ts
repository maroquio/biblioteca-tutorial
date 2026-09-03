import type { UseCases } from "./composition";
import { DomainError, InvalidValue } from "./domain/errors";
import { InvalidInput, NotFound, RuleConflict } from "./errors";
import { match, type Route } from "./router";
import { livroRoutes } from "./routes/livros";

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
  const routes: Route[] = [
    {
      method: "GET",
      pattern: "/",
      handler: () => Response.json({ message: "API da Biblioteca" }),
    },
    ...livroRoutes(useCases),
  ];

  return Bun.serve({
    port: porta,

    async fetch(request) {
      const url = new URL(request.url);

      try {
        for (const route of routes) {
          if (route.method !== request.method) continue;

          const params = match(route.pattern, url.pathname);
          if (params) return await route.handler(request, params);
        }

        return Response.json(
          { error: "Recurso não encontrado" },
          { status: 404 },
        );
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
}
