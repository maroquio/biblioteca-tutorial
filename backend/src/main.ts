import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { refreshDerivedData, refreshDerivedDataOnConnect } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// o banco pode ter mudado enquanto o servidor ou o Redis estavam parados:
// cada conexão ao Redis recalcula os dados derivados, e sem Redis a reconciliação
// dos vetores no Postgres acontece mesmo assim na subida
refreshDerivedDataOnConnect();
if (redis) {
  void ready(redis).catch(() => {
    console.warn("Redis indisponível: seguindo sem cache");
    void refreshDerivedData();
  });
} else {
  void refreshDerivedData();
}
