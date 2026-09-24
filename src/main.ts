import { buildUseCases } from "./composition";
import { createAcervoTables } from "./modules/acervo";
import { createAvaliacaoTables } from "./modules/acervo/infrastructure/schema";
import { createAutoriaTables } from "./modules/autoria";
import { createServer } from "./server";

createAutoriaTables();
createAcervoTables();
createAvaliacaoTables();

const server = createServer(buildUseCases());

console.log(`Servidor executando em http://localhost:${server.port}`);
