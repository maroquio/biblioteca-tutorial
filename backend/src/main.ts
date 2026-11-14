import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { reconcileSemanticIndex, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// o banco pode ter mudado enquanto o servidor estava parado (o seed escreve direto nas
// tabelas): os vetores da busca semântica, que moram no Postgres, são reconciliados na
// subida, com ou sem Redis, em segundo plano
void reconcileSemanticIndex();

// o cache de autores, esse sim no Redis, é invalidado a cada conexão (a primeira e as reconexões)
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache de autores"));
