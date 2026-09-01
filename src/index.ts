import { createDb } from "./db";

createDb();

type Handler = (
  request: Request,
  params: Record<string, string>,
) => Response | Promise<Response>;

type Route = { method: string; pattern: string; handler: Handler };

function match(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    const received = pathParts[i]!;

    if (expected.startsWith(":")) {
      params[expected.slice(1)] = received;
    } else if (expected !== received) {
      return null;
    }
  }

  return params;
}

const routes: Route[] = [
  {
    method: "GET",
    pattern: "/",
    handler: () => Response.json({ message: "API da Biblioteca" }),
  },
  {
    // rota descartável: existe só para provarmos a captura de parâmetros.
    // Some na fase 10, quando a primeira rota de verdade com parâmetro chegar.
    method: "GET",
    pattern: "/eco/:mensagem",
    handler: (_request, params) => Response.json({ eco: params.mensagem }),
  },
];

const server = Bun.serve({
  port: 3000,

  async fetch(request) {
    const url = new URL(request.url);

    for (const route of routes) {
      if (route.method !== request.method) continue;

      const params = match(route.pattern, url.pathname);
      if (params) return await route.handler(request, params);
    }

    return Response.json({ error: "Recurso não encontrado" }, { status: 404 });
  },
});

console.log(`Servidor executando em http://localhost:${server.port}`);
