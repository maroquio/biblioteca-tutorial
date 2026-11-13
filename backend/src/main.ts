import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { reconcileBookVectors, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// livros sem vetor (seed, Gemini fora do ar) ganham vetor na subida, em segundo
// plano. Os vetores estão no Postgres: isto não espera nem depende do Redis
void reconcileBookVectors();

// o banco pode ter mudado enquanto o Redis estava parado: cada conexão ao Redis
// invalida o cache de autores
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
