import type { Hono } from "hono";
import { sql } from "../../infrastructure/postgres";
import { seedReport } from "./report";
import { refreshDerivedData } from "../derivedData";
import { runSeed } from "./run";

/** UC23: consulta e executa a carga de demonstração (seed). */
export function registerRoutes(api: Hono): void {
  api.get("/seed", async c => c.json(await seedReport(sql)));
  api.post("/seed", async c => {
    const result = await runSeed();
    // o seed escreve direto nas tabelas, sem passar pelos casos de uso
    await refreshDerivedData();
    return c.json(result, 200);
  });
}