import { ClickHouseError } from "@clickhouse/client";

// ClickHouse spells out exact table/column names in access-denied errors and
// returns distinct errors for "exists but no read grant" vs "doesn't exist".
// Forwarding them verbatim turns the SQL endpoint into a schema-enumeration
// oracle. Collapse every schema-probing error into one uniform message.
const SCHEMA_PROBE_ERROR_TYPES = new Set([
  "ACCESS_DENIED",
  "UNKNOWN_TABLE",
  "UNKNOWN_DATABASE",
]);
const SCHEMA_PROBE_ERROR_CODES = new Set(["497", "60", "81"]);

export const SCHEMA_PROBE_MESSAGE =
  "Query references a table that doesn't exist or isn't available to you. " +
  "Readable tables: traces, logs, metrics_gauge, metrics_sum, " +
  "metrics_histogram, metrics_exponential_histogram, metrics_summary, " +
  "traces_trace_id_ts.";

export function sanitizeSqlApiError(error: unknown): string {
  if (
    error instanceof ClickHouseError &&
    (SCHEMA_PROBE_ERROR_TYPES.has(error.type ?? "") ||
      SCHEMA_PROBE_ERROR_CODES.has(error.code))
  ) {
    return SCHEMA_PROBE_MESSAGE;
  }
  return error instanceof Error
    ? error.message
    : "Failed to execute SQL query.";
}
