import { ClickHouseError } from "@clickhouse/client";
import { createFileRoute } from "@tanstack/react-router";
import { querySqlApi } from "@/lib/clickhouse";

function toNdjson(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }

  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

// ClickHouse spells out the exact table and column names in its access-denied
// errors ("necessary to have the grant SELECT(col1, col2) ON db.table"), and
// returns a *distinct* error for "exists but you can't read it" (ACCESS_DENIED)
// vs "doesn't exist" (UNKNOWN_TABLE/UNKNOWN_DATABASE). Forwarding those verbatim
// turns the /sql endpoint into a schema-enumeration oracle: a caller can probe
// table names, learn which exist, and read off the columns of internal,
// non-granted tables (plus the per-org CH username, which prefixes the message).
// Collapse every schema-probing error into one uniform message so the response
// reveals nothing beyond the tables the caller is already allowed to read.
//
// Match on both error type and numeric code for robustness (`type` can be
// undefined on errors the client couldn't fully parse).
const SCHEMA_PROBE_ERROR_TYPES = new Set([
  "ACCESS_DENIED",
  "UNKNOWN_TABLE",
  "UNKNOWN_DATABASE",
]);
const SCHEMA_PROBE_ERROR_CODES = new Set(["497", "60", "81"]);

// Naming the readable tables is safe — they are the caller's own tenant-scoped
// tables by design. Keep in sync with SQL_API_TENANT_TABLES in @/lib/clickhouse.
const SCHEMA_PROBE_MESSAGE =
  "Query references a table that doesn't exist or isn't available to you. " +
  "Readable tables: traces, logs, metrics_gauge, metrics_sum, " +
  "metrics_histogram, metrics_exponential_histogram, metrics_summary.";

function sanitizeSqlApiError(error: unknown): string {
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

export const Route = createFileRoute("/api/cli/sql")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const sql = await request.text();

        if (!sql.trim()) {
          return Response.json(
            { error: "SQL query is required." },
            { status: 400 },
          );
        }

        try {
          const rows = await querySqlApi<Record<string, unknown>>(
            sql,
            context.session.session.activeOrganizationId,
          );

          return new Response(toNdjson(rows), {
            headers: {
              "content-type": "application/x-ndjson; charset=utf-8",
            },
          });
        } catch (error) {
          return Response.json(
            { error: sanitizeSqlApiError(error) },
            { status: 400 },
          );
        }
      },
    },
  },
});
