import type { SqlClient } from "@everr/telemetry-explorer/logs";
import { captureLocalSqlError } from "@/lib/internal-telemetry";
import { invokeCommand } from "@/lib/local-api";

/**
 * Forwards SQL and `{name:Type}` parameters to the local command, which sends
 * them to the local sqlhttp endpoint as `param_<name>` query string entries.
 * Parameter substitution happens server-side using ClickHouse escape rules.
 */
export const localSqlClient: SqlClient = {
  execute: async <Row>(sql: string, params: Record<string, unknown>): Promise<Row[]> => {
    try {
      return await invokeCommand<Row[]>("telemetry_sql_query", { sql, params });
    } catch (error) {
      captureLocalSqlError(error);
      throw error;
    }
  },
};
