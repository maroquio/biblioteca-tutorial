import { sql } from "../../../../infrastructure/postgres";
import type { ReadersIntegration } from "../../domain/ReadersIntegration";

export async function getReader(id: number, integration: ReadersIntegration): Promise<ReaderView> {
  return toReaderView(sql, await findReader(sql, id), integration);
}
function toReaderView(sql: any, arg1: any, integration: ReadersIntegration): any {
    throw new Error("Function not implemented.");
}

