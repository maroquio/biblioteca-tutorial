import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { reconcileBookVectors, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// os livros podem ter mudado enquanto o servidor estava parado. Os vetores da busca
// semântica moram no Postgres: a reconciliação deles não espera o Redis
void reconcileBookVectors();

// o cache de autores mora no Redis: cada conexão a ele o recalcula, em segundo plano
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem o cache da busca de autores"));
