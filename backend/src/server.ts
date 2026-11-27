import { Hono, type MiddlewareHandler } from "hono";
import { serveStatic } from "hono/bun";
import { routePath } from "hono/route";
import { log } from "./infrastructure/log";
import { continueTrace, withTrace } from "./infrastructure/trace";
import { DomainError, InvalidValue } from "./shared/domain-errors";
import { InvalidInput, NotFound, NotImplemented, PayloadTooLarge, RuleConflict, ServiceUnavailable } from "./shared/errors";
import type { RegisterRoutes } from "./shared/http";

/** O build do React (`bun run build` em frontend/), relativo à pasta backend/. */
const FRONTEND = "../frontend/dist";

function errorResponse(error: unknown): Response {
  if (error instanceof InvalidInput || error instanceof InvalidValue || error instanceof SyntaxError) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof NotFound) {
    return Response.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof RuleConflict || error instanceof DomainError) {
    return Response.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof PayloadTooLarge) {
    return Response.json({ error: error.message }, { status: 413 });
  }

  if (error instanceof NotImplemented) {
    return Response.json({ error: error.message }, { status: 501 });
  }

  if (error instanceof ServiceUnavailable) {
    return Response.json({ error: error.message }, { status: 503 });
  }

  // só o inesperado vai para o log como erro; o trace_id liga a linha à resposta
  log.error("erro interno", { error: error as Error, stack: (error as Error)?.stack });

  return Response.json({ error: "Erro interno" }, { status: 500 });
}

/**
 * Toda requisição da API passa por aqui: continua o traceparent recebido (ou
 * começa um), roda o resto dentro dele, devolve o cabeçalho na resposta e
 * registra uma linha de log.
 */
const observe: MiddlewareHandler = (c, next) => {
  const traceparent = continueTrace(c.req.header("traceparent"));
  return withTrace(traceparent, async () => {
    const start = performance.now();
    await next();
    const seconds = (performance.now() - start) / 1000;
    // o padrão da rota que respondeu ("/api/livros/:id"), nunca a URL com o id:
    // depois do next(), o Hono aponta routeIndex para o handler que respondeu
    const route = routePath(c);
    c.header("traceparent", traceparent);
    log.info("requisição", { method: c.req.method, route, status: c.res.status, duration_ms: Math.round(seconds * 1000) });
  });
};

export function createApp(slices: RegisterRoutes[] = []) {
  const api = new Hono();

  api.use("*", observe);

  api.get("/", (context) => context.json({ message: "API da Biblioteca" }));

  for (const registerRoutes of slices) registerRoutes(api);

  const app = new Hono();

  // toda a API mora sob /api: o resto dos endereços fica livre para o frontend
  app.route("/api", api);
  app.all("/api/*", (context) => context.notFound());

  // arquivos do build: index.html, JS, CSS, ícone
  app.use("*", serveStatic({ root: FRONTEND }));

  // qualquer outro endereço (/cadastrar, por exemplo) é rota do React Router:
  // devolve o index.html e o roteador do navegador decide o que mostrar
  app.get("*", serveStatic({ path: `${FRONTEND}/index.html` }));

  app.notFound((context) =>
    context.json({ error: "Recurso não encontrado" }, 404),
  );

  app.onError((error) => errorResponse(error));

  return app;
}

export function createServer(
  slices: RegisterRoutes[],
  port = Number(process.env.PORT ?? 3000),
) {
  return Bun.serve({ port, fetch: createApp(slices).fetch });
}