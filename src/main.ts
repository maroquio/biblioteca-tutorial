import { buildUseCases } from "./composition";
import { createAcervoTables } from "./modules/acervo";
import { createAutoriaTables } from "./modules/autoria";
import { createAvaliacaoTables } from "./modules/avaliacao";
import { createCirculacaoTables } from "./modules/circulacao";
import { createServer } from "./server";

createAutoriaTables();
createAcervoTables();
createCirculacaoTables();
createAvaliacaoTables();

const server = createServer(buildUseCases());

console.log(`Servidor executando em http://localhost:${server.port}`);
