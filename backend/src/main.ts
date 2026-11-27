import { loadSlices, prepareDatabase } from "./composition";
import { log } from "./infrastructure/log";
import { ready, redis } from "./infrastructure/redis";
import { refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

log.info("servidor no ar", { url: `http://localhost:${server.port}` });

// o banco pode ter mudado enquanto o servidor ou o Redis estavam parados:
// cada conexão ao Redis recalcula os dados derivados, em segundo plano
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => log.warn("Redis indisponível: seguindo sem cache e sem busca semântica"));
