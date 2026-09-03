import { buildUseCases } from "./composition";
import { createAcervoTables } from "./modules/acervo";
import { createAutoriaTables } from "./modules/autoria";
import { createServer } from "./server";

createAutoriaTables();
createAcervoTables();

const server = createServer(buildUseCases());

console.log(`Servidor executando em http://localhost:${server.port}`);
