import { captureError } from "@everr/otel-web";
import type { SqlClient } from "@everr/telemetry-explorer/logs";
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
    try {
      return await invokeCommand<Row[]>("telemetry_sql_query", { sql, params });
    } catch (error) {
      captureError(error, {
        "error.handled": true,
        "error.source": "desktop.local_sql",
      });
      throw error;
    }
  },
};
