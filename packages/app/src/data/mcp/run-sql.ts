import { ClickHouseError } from "@clickhouse/client";
import { assertOrganizationProvisioned } from "@/common/organization-provisioning";
import {
  MCP_MAX_CELL_CHARS,
  MCP_MAX_ROWS,
} from "@/data/mcp/query-tool-description";
import { previewSqlApi } from "@/lib/clickhouse";
import { sanitizeSqlApiError } from "@/lib/sql-api-error";
import { truncateWithEllipsis } from "@/lib/truncate";

export interface RunSqlResult {
  isError: boolean;
  /** The rows in ClickHouse's JSONCompactEachRowWithNamesAndTypes, or the error. */
  text: string;
  /** Row count, truncation, or a hint for the next query. */
  note?: string;
}

/**
 * Execute a read-only SQL query for an MCP connection. The org is taken from the
 * verified access-token claim (no longer resolved here). Runs the query via the
 * tenant-scoped SQL API and returns the first rows or a sanitized error string,
 * each with a note for the next query. Never throws.
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
    const result = await previewSqlApi(sql, args.orgId, MCP_MAX_ROWS);
    const text = [result.columns, result.columnTypes, ...result.rows]
      .map((line) => JSON.stringify(line.map(truncateCell)))
      .join("\n");
    return { isError: false, text, note: resultNote(result) };
  } catch (error) {
    return {
      isError: true,
      text: sanitizeSqlApiError(error),
      note: errorHint(error),
    };
  }
}

function resultNote(result: { rows: unknown[]; truncated: boolean }): string {
  if (result.truncated) {
    return `First ${MCP_MAX_ROWS} rows shown; the query had more and was stopped. Aggregate or add a smaller LIMIT.`;
  }
  if (result.rows.length === 0) {
    return `0 rows. ${STARTER_QUERIES_HINT}`;
  }
  return `${result.rows.length} ${result.rows.length === 1 ? "row" : "rows"}.`;
}

function truncateCell(value: unknown): unknown {
  // JSON and Map columns come back as objects; cap their serialized size too.
  const text =
    typeof value === "string"
      ? value
      : value !== null && typeof value === "object"
        ? JSON.stringify(value)
        : undefined;
  if (text === undefined || text.length <= MCP_MAX_CELL_CHARS) return value;
  const cut = truncateWithEllipsis(text, MCP_MAX_CELL_CHARS);
  return `${cut}[+${text.length - cut.length + 1} chars]`;
}

// The queries themselves live once, in the tool description.
const STARTER_QUERIES_HINT =
  "Widen the time window, check the ServiceName spelling, and check freshness with the first query under Starter Queries in the tool description.";
const SCHEMA_HINT =
  "Check the Tables section of the tool description, run DESCRIBE TABLE <table>, or list attribute keys as shown under Attributes.";
const NARROW_SCAN_HINT =
  "Narrow the time window and filter on ServiceName (the sort key).";

const ERROR_HINTS: Record<string, string> = {
  UNKNOWN_IDENTIFIER: SCHEMA_HINT,
  NO_SUCH_COLUMN_IN_TABLE: SCHEMA_HINT,
  TOO_MANY_ROWS_OR_BYTES:
    "The result is too large. Aggregate, select fewer columns, or add LIMIT.",
  TIMEOUT_EXCEEDED: NARROW_SCAN_HINT,
  TOO_SLOW: NARROW_SCAN_HINT,
  TOO_MANY_ROWS: NARROW_SCAN_HINT,
  TOO_MANY_BYTES: NARROW_SCAN_HINT,
};

// Grouping by or comparing a raw JSON attribute fails with a message that names
// the Dynamic type; its error type is shared with unrelated failures.
const DYNAMIC_HINT =
  "Attribute values are Dynamic. Wrap them: toString(SpanAttributes.`key`), or toFloat64OrZero(toString(...)) for numbers.";

function errorHint(error: unknown): string | undefined {
  if (!(error instanceof ClickHouseError)) return undefined;
  return (
    ERROR_HINTS[error.type ?? ""] ??
    (error.message.includes("Dynamic") ? DYNAMIC_HINT : undefined)
  );
}
