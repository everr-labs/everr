import type { SqlClient } from "@everr/telemetry-explorer/logs";
import { z } from "zod";
import { captureLocalSqlError } from "@/lib/internal-telemetry";
import { invokeCommand } from "@/lib/local-api";

const SqlRowsSchema = z.array(z.record(z.string(), z.json()));

/**
 * Forwards SQL and `{name:Type}` parameters to the local command, which sends
 * them to the local sqlhttp endpoint as `param_<name>` query string entries.
 * Parameter substitution happens server-side using ClickHouse escape rules.
 */
export const localSqlClient: SqlClient = {
  execute: async <Row>(sql: string, params: Record<string, unknown>): Promise<Row[]> => {
    try {
      const rows = await invokeCommand("telemetry_sql_query", SqlRowsSchema, { sql, params });
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SqlClient's query-specific Row is supplied by the repository; the transport validates JSON object rows, not each query's columns.
      return rows as Row[];
    } catch (error) {
      captureLocalSqlError(error);
      throw error;
    }
  },
};
