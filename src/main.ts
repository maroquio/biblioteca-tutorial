import { buildUseCases } from "./composition";
import { createDb } from "./db";
import { createServer } from "./server";

createDb();

const server = createServer(buildUseCases());

console.log(`Servidor executando em http://localhost:${server.port}`);
