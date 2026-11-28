import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshBookVectors, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

void refreshBookVectors();
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache de autores"));
