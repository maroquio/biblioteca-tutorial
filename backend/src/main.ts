import { loadSlices, prepareDatabase } from "./composition";
import { refreshDerivedData } from "./integration/derivedData";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// em segundo plano: o banco pode ter mudado enquanto o servidor estava parado
void refreshDerivedData();