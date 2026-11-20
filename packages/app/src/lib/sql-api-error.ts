import { ClickHouseError } from "@clickhouse/client";
import { SQL_API_TABLE_COLUMNS, SQL_API_TABLES } from "#app/lib/sql-api-tables.ts";

// ClickHouse spells out exact table/column names in access-denied errors and
// returns distinct errors for "exists but no read grant" vs "doesn't exist".
// Forwarding them verbatim turns the SQL endpoint into a schema-enumeration
// oracle. Collapse every schema-probing error into one uniform message.
const SCHEMA_PROBE_ERROR_TYPES = new Set(["ACCESS_DENIED", "UNKNOWN_TABLE", "UNKNOWN_DATABASE"]);
const SCHEMA_PROBE_ERROR_CODES = new Set(["497", "60", "81"]);

export const SCHEMA_PROBE_MESSAGE =
  "Query references a table that doesn't exist or isn't available to you. " +
  `Readable tables: ${SQL_API_TABLES.join(", ")}.`;

// A table read through a column grant refuses SELECT *, DESCRIBE, and the
// columns left out of the grant. The table is in the readable list already,
// so naming it and its columns gives nothing away.
function columnGrantMessage(message: string): string | undefined {
  for (const [table, columns] of Object.entries(SQL_API_TABLE_COLUMNS)) {
    if (new RegExp(`\\bON \\w+\\.${table}\\b`).test(message)) {
      return (
        `${table} is readable by column only. Name the columns: SELECT *, DESCRIBE, ` +
        `and columns outside this list are refused. Columns: ${columns.join(", ")}.`
      );
    }
  }
  return undefined;
}

export function sanitizeSqlApiError(error: unknown): string {
  if (
    error instanceof ClickHouseError &&
    (SCHEMA_PROBE_ERROR_TYPES.has(error.type ?? "") || SCHEMA_PROBE_ERROR_CODES.has(error.code))
  ) {
    return columnGrantMessage(error.message) ?? SCHEMA_PROBE_MESSAGE;
  }
  return error instanceof Error ? error.message : "Failed to execute SQL query.";
}
