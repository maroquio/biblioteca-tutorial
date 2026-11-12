import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshBookVectors, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// o banco pode ter mudado enquanto o servidor estava parado: os vetores dos
// livros estão no Postgres, e a reconciliação da subida não depende do Redis
void refreshBookVectors();

// cada conexão ao Redis invalida o cache da busca de autores, em segundo plano
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
