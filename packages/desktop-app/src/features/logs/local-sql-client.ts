import type { SqlClient } from "@everr/logs-explorer";
import { invokeCommand } from "@/lib/tauri";
import { substituteParams } from "./param-substitute";

export const localSqlClient: SqlClient = {
  execute: async <Row>(
    sql: string,
    params: Record<string, unknown>,
  ): Promise<Row[]> => {
    const finalSql = substituteParams(sql, params);
    return invokeCommand<Row[]>("telemetry_sql_query", { sql: finalSql });
  },
};
