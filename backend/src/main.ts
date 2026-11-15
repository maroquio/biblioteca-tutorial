import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshDerivedData, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();
await refreshDerivedData();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// Redis ainda guarda o cache de autores; sua reconexão apenas invalida esse cache.
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache de autores"));
