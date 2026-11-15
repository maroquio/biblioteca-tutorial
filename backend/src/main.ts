
import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import {
  refreshAuthorSearchOnConnect,
  refreshBookVectors,
} from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// Reconcilia os vetores diretamente no PostgreSQL,
// independentemente da conexão com o Redis.
void refreshBookVectors();

// O Redis continua responsável pelo cache de buscas de autores.
refreshAuthorSearchOnConnect();

if (redis) {
  void ready(redis).catch(() =>
    console.warn("Redis indisponível: seguindo sem cache de autores"),
  );
}
