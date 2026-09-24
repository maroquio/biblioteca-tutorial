import { buildUseCases } from "./composition";
import { createAcervoTables } from "./modules/acervo";
import { createAutoriaTables } from "./modules/autoria";
import { createAvaliacaoTables } from "./modules/avaliacao";
import { createServer } from "./server";

createAutoriaTables();
createAcervoTables();
createAvaliacaoTables();

const server = createServer(buildUseCases());

console.log(`Servidor executando em http://localhost:${server.port}`);
