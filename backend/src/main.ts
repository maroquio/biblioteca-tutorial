import { loadSlices, prepareDatabase } from "./composition";
import { ready, redis } from "./infrastructure/redis";
import { catalogIntegration } from "./integration/catalogIntegration";
import { refreshDerivedDataOnConnect } from "./integration/derivedData";
import { invalidateAuthorSearch } from "./modules/authorship";
import { reconcileBookIndex } from "./modules/catalog";
import { createServer } from "./server";

await prepareDatabase();

const server = createServer(await loadSlices());

console.log(`Servidor executando em http://localhost:${server.port}`);

// os vetores moram no Postgres: a reconciliação roda em toda subida, em segundo
// plano, com ou sem Redis (livros do seed ou cadastrados com o Gemini fora do ar)
void reconcileBookIndex(catalogIntegration).then(({ indexed }) => console.log(`Índice semântico: ${indexed} livro(s) indexado(s) no pgvector`));

// o Redis agora só guarda o cache de autores, que pode ter ficado velho enquanto
// ele esteve fora: cada conexão (a primeira e cada reconexão) só invalida o cache
refreshDerivedDataOnConnect(redis, invalidateAuthorSearch);
if (redis) void ready(redis).catch(() => console.warn("Redis indisponível: seguindo sem o cache da busca de autores"));
