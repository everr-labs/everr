import { ClickHouseError } from "@clickhouse/client";
import { assertOrganizationProvisioned } from "@/common/organization-provisioning";
import { querySqlApiWithMeta } from "@/lib/clickhouse";
import { sanitizeSqlApiError } from "@/lib/sql-api-error";

// The SQL API caps results at 25k rows / 4 MB, sized for dashboards. An LLM
// pays for every row in context, so the MCP tool shows far less and says so.
export const MCP_MAX_ROWS = 200;
export const MCP_MAX_CELL_CHARS = 2000;

export interface RunSqlResult {
  isError: boolean;
  text: string;
}

/**
 * Execute a read-only SQL query for an MCP connection. The org is taken from the
 * verified access-token claim (no longer resolved here). Runs the query via the
 * tenant-scoped SQL API and returns a compact table or a sanitized error string
 * with a hint for the next query. Never throws.
 */
export async function runSqlForConnection(args: {
  orgId: string;
  metadata: unknown;
  sql: string;
}): Promise<RunSqlResult> {
  const sql = args.sql.trim();
  if (!sql) {
    return { isError: true, text: "SQL query is required." };
  }

  try {
    assertOrganizationProvisioned(args.metadata);
    const result = await querySqlApiWithMeta<Record<string, unknown>>(
      sql,
      args.orgId,
    );
    return { isError: false, text: formatResult(result) };
  } catch (error) {
    const message = sanitizeSqlApiError(error);
    const hint = errorHint(error);
    return {
      isError: true,
      text: hint ? `${message}\nHint: ${hint}` : message,
    };
  }
}

// One header line with column names and types, then one JSON array per row:
// the keys are not repeated on every row as they would be in NDJSON.
function formatResult(result: {
  rows: Record<string, unknown>[];
  columns: string[];
  columnTypes: string[];
}): string {
  const header = `columns: ${JSON.stringify(
    Object.fromEntries(
      result.columns.map((c, i) => [c, result.columnTypes[i]]),
    ),
  )}`;
  const total = result.rows.length;
  if (total === 0) {
    return (
      `${header}\n(0 rows)\n` +
      "Hint: widen the time window, check the ServiceName spelling, and check " +
      "freshness with SELECT ServiceName, max(Timestamp) FROM <table> " +
      "WHERE Timestamp > now() - INTERVAL 1 DAY GROUP BY ServiceName LIMIT 50."
    );
  }

  const lines = result.rows
    .slice(0, MCP_MAX_ROWS)
    .map((row) =>
      JSON.stringify(result.columns.map((c) => truncateCell(row[c]))),
    );
  const footer =
    total > MCP_MAX_ROWS
      ? `(${MCP_MAX_ROWS} of ${total} rows shown. Aggregate or add a smaller LIMIT.)`
      : `(${total} ${total === 1 ? "row" : "rows"})`;
  return [header, ...lines, footer].join("\n");
}

function truncateCell(value: unknown): unknown {
  if (typeof value === "string") return truncateString(value);
  // JSON and Map columns come back as objects; cap their serialized size too.
  if (value !== null && typeof value === "object") {
    const json = JSON.stringify(value);
    return json.length > MCP_MAX_CELL_CHARS ? truncateString(json) : value;
  }
  return value;
}

function truncateString(value: string): string {
  if (value.length <= MCP_MAX_CELL_CHARS) return value;
  return `${value.slice(0, MCP_MAX_CELL_CHARS)}…[+${value.length - MCP_MAX_CELL_CHARS} chars]`;
}

const ERROR_HINTS: Record<string, string> = {
  UNKNOWN_IDENTIFIER:
    "run DESCRIBE TABLE <table> for columns. For attribute keys, list them " +
    "with SELECT arrayJoin(SpanAttributesKeys) AS k, count() FROM traces " +
    "WHERE Timestamp > now() - INTERVAL 1 HOUR GROUP BY k LIMIT 100.",
  NO_SUCH_COLUMN_IN_TABLE: "run DESCRIBE TABLE <table> for columns.",
  TOO_MANY_ROWS_OR_BYTES:
    "the result is too large. Aggregate, select fewer columns, or add LIMIT.",
  TIMEOUT_EXCEEDED:
    "narrow the Timestamp window and filter on ServiceName (the sort key).",
  TOO_SLOW:
    "narrow the Timestamp window and filter on ServiceName (the sort key).",
  TOO_MANY_ROWS:
    "the scan is too large. Narrow the Timestamp window and filter on ServiceName.",
  TOO_MANY_BYTES:
    "the scan is too large. Narrow the Timestamp window and filter on ServiceName.",
};

const DYNAMIC_HINT =
  "attribute values are Dynamic. Wrap them: toString(SpanAttributes.`key`), " +
  "or toFloat64OrZero(toString(...)) for numbers.";

function errorHint(error: unknown): string | undefined {
  if (!(error instanceof ClickHouseError)) return undefined;
  const hint = ERROR_HINTS[error.type ?? ""];
  if (hint) return hint;
  if (error.message.includes("Dynamic")) return DYNAMIC_HINT;
  return undefined;
}
