import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshBookVectors, refreshRedisDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();
// Os vetores agora vivem no Postgres e precisam estar em dia mesmo sem Redis.
await refreshBookVectors();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// Quando o Redis volta, somente o cache de autores precisa ser invalidado.
refreshRedisDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache de autores"));
