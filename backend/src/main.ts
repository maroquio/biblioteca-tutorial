import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { catalogIntegration } from "./integration/catalogIntegration";
import { refreshDerivedDataOnConnect } from "./integration/derivedData";
import { reconcileBookIndex } from "./modules/catalog";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// PostgreSQL owns the vectors, so reconciliation does not depend on Redis.
void reconcileBookIndex(catalogIntegration).then(({ indexed }) => {
  console.log(`Índice semântico: ${indexed} livro(s) indexado(s)`);
});

// Redis continues to support the author-search cache.
refreshDerivedDataOnConnect();

if (redis) {
  void ready(redis).catch(() =>
    console.warn("Redis indisponível: seguindo sem cache de autores"),
  );
}
