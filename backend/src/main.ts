import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshBookVectors, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// o cache de autores mora no Redis: cada conexão (e reconexão) o invalida
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache de autores"));

// os vetores moram no Postgres: reconciliar na subida não espera o Redis, e nenhum Redis parado impede
void refreshBookVectors().catch((error) => console.warn("Índice semântico indisponível:", (error as Error).message));