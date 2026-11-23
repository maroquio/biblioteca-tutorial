import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { reconcileSemanticIndex, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// o banco pode ter mudado enquanto o servidor estava parado (o seed, um livro
// cadastrado com o Gemini fora do ar): reconcilia os vetores em segundo plano.
// Eles moram no Postgres, então isso não espera nem depende do Redis
void reconcileSemanticIndex();

// o cache de autores, sim, é do Redis: cada conexão a ele invalida o cache
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));
