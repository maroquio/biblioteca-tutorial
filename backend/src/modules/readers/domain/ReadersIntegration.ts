import type { SQL, TransactionSQL } from "bun";

export type ReadersDb = SQL | TransactionSQL;

export type ReadersIntegration = { countBooks: (db: ReadersDb, readerId: number) => Promise<number> };
