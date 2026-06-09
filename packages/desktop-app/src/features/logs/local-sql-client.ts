import type { SqlClient } from "@everr/telemetry-explorer/logs";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";
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
      const isError = error instanceof Error;
      logs.getLogger("everr-desktop.local-sql").emit({
        severityNumber: SeverityNumber.ERROR,
        severityText: "ERROR",
        body: "everr.desktop.local_sql.query_error",
        attributes: {
          "exception.type": isError ? error.name : "Error",
          "exception.message": isError ? error.message : String(error),
          "exception.stacktrace": isError ? (error.stack ?? "") : "",
          "error.handled": true,
        },
        exception: isError ? error : undefined,
      });
      throw error;
    }
  },
};
