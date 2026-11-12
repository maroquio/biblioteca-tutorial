import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshDerivedData, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// em segundo plano: o banco pode ter mudado enquanto o servidor estava parado;
// reconcilia os vetores no Postgres independentemente do Redis
void refreshDerivedData();

// cada conexão ao Redis recalcula os dados de cache dele
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
