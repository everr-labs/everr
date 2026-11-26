import { ClickHouseError } from "@clickhouse/client";
import { SQL_API_TABLES, SQL_API_WITHHELD_COLUMNS } from "#app/lib/sql-api-tables.ts";

// ClickHouse spells out exact table/column names in access-denied errors and
// returns distinct errors for "exists but no read grant" vs "doesn't exist".
// Forwarding them verbatim turns the SQL endpoint into a schema-enumeration
// oracle. Collapse every schema-probing error into one uniform message.
const SCHEMA_PROBE_ERROR_TYPES = new Set(["ACCESS_DENIED", "UNKNOWN_TABLE", "UNKNOWN_DATABASE"]);
const SCHEMA_PROBE_ERROR_CODES = new Set(["497", "60", "81"]);

export const SCHEMA_PROBE_MESSAGE =
  "Query references a table that doesn't exist or isn't available to you. " +
  `Readable tables: ${SQL_API_TABLES.join(", ")}.`;

// A table with withheld columns refuses SELECT *, DESCRIBE, and those columns
// with an access error. The table is in the readable list already, so naming
// it and its withheld columns gives nothing away.
function withheldColumnMessage(message: string): string | undefined {
  for (const [table, columns] of Object.entries(SQL_API_WITHHELD_COLUMNS)) {
    if (new RegExp(`\\bON \\w+\\.${table}\\b`).test(message)) {
      const names = columns.join(", ");
      const [first] = columns;
      return (
        `${table}: ${columns.length === 1 ? `column ${names} is` : `columns ${names} are`} not readable, ` +
        `and SELECT * and DESCRIBE are refused. Name the columns or use SELECT * EXCEPT (${names}). ` +
        `length(${first}) works.`
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
    return withheldColumnMessage(error.message) ?? SCHEMA_PROBE_MESSAGE;
  }
  return error instanceof Error ? error.message : "Failed to execute SQL query.";
}
