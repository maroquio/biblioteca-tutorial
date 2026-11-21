import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshDerivedData, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

refreshDerivedDataOnConnect();
void refreshDerivedData();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
