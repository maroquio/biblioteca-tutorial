import { createDb } from "./db";
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
