import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshDerivedData, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// Reconcilia os dados derivados (índice vetorial dos livros e cache de autores) na subida,
// sem depender do Redis e sem derrubar o servidor se algo falhar
void refreshDerivedData().catch((error) =>
  console.warn("Falha ao reconciliar dados derivados:", (error as Error).message),
);

// O Redis continua cuidando do cache de autores:
refreshDerivedDataOnConnect();
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem cache"));