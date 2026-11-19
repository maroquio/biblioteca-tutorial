import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { reconcileSearchVectors, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// os vetores estão no Postgres: reconcilia na subida, sem depender do Redis
void reconcileSearchVectors();
// o cache de autores pode ter ficado para trás enquanto o Redis estava parado:
// cada conexão a ele o invalida, em segundo plano
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
