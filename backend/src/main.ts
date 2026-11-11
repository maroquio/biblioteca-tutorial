import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { catalogIntegration } from "./integration/catalogIntegration";
import { refreshDerivedDataOnConnect } from "./integration/derivedData";
import { reconcileBookIndex } from "./modules/catalog";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// reconcilia os vetores no Postgres na subida, sem depender do Redis
void reconcileBookIndex(catalogIntegration);

// o banco pode ter mudado enquanto o servidor ou o Redis estavam parados:
// cada conexão ao Redis recalcula os dados derivados, em segundo plano
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
