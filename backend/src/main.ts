import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { catalogIntegration } from "./integration/catalogIntegration";
import { refreshDerivedDataOnConnect } from "./integration/derivedData";
import { reconcileBookIndex } from "./modules/catalog";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

void reconcileBookIndex(catalogIntegration);
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
