import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { reconcileBookVectors, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// os vetores da busca semântica estão no Postgres: o servidor os reconcilia na
// subida, em segundo plano, com ou sem Redis (seed, Gemini fora do ar, autor renomeado...)
void reconcileBookVectors();

// já o cache de autores é do Redis: cada conexão o invalida, em segundo plano
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache de buscas de autores"));
