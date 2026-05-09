/**
 * Substitutes ClickHouse parameter placeholders client-side before invoking the
 * Tauri SQL command. The local chdb endpoint at SQL_HTTP_PORT only accepts a raw
 * SQL string, so the package's `{name:Type}` placeholders are rendered to literal
 * values here. Safe because the endpoint is bound to 127.0.0.1 and inputs are
 * zod-validated upstream; would not be safe if the endpoint ever became
 * network-reachable.
 */
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
