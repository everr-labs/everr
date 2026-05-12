import type { SqlClient } from "@everr/logs-explorer";
import { invokeCommand } from "@/lib/tauri";

/**
 * Forwards SQL and `{name:Type}` parameters to the Tauri command, which sends
 * them to the local sqlhttp endpoint as `param_<name>` query string entries.
 * Parameter substitution happens server-side using ClickHouse escape rules.
 */
export const localSqlClient: SqlClient = {
  execute: async <Row>(
    sql: string,
    params: Record<string, unknown>,
  ): Promise<Row[]> => {
    return invokeCommand<Row[]>("telemetry_sql_query", { sql, params });
  },
};
