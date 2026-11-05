import { prepareDatabase } from "./composition";
import { sql } from "./infrastructure/postgres";
import { redis } from "./infrastructure/redis";
import { refreshDerivedData } from "./integration/derivedData";
import { runSeed } from "./integration/seed/run";

try {
  await prepareDatabase();
  console.log(JSON.stringify(await runSeed(), null, 2));
  await refreshDerivedData();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { await sql.close(); redis?.close(); }