import { Database } from "bun:sqlite";

export const db = new Database("data/biblioteca.sqlite", { create: true });

db.run("PRAGMA foreign_keys = ON;");

// dois processos podem abrir este arquivo ao mesmo tempo — o servidor e o
// teste. Sem isto o segundo leva SQLITE_BUSY na hora, em vez de esperar.
db.run("PRAGMA busy_timeout = 5000;");