import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshDerivedData, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// o banco pode ter mudado enquanto o servidor estava parado: os vetores dos livros
// moram no Postgres, então a reconciliação na subida não depende do Redis
void refreshDerivedData();

// cada conexão ao Redis (a primeira e cada reconexão) invalida o cache de autores
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem o cache de autores"));
