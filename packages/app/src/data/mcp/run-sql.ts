import { ClickHouseError } from "@clickhouse/client";
import { assertOrganizationProvisioned } from "@/common/organization-provisioning";
import {
  MCP_MAX_CELL_CHARS,
  MCP_MAX_OUTPUT_CHARS,
  MCP_MAX_ROWS,
} from "@/data/mcp/query-tool-description";
import { previewSqlApi } from "@/lib/clickhouse";
import { sanitizeSqlApiError } from "@/lib/sql-api-error";
import { classifyCloudQueryError } from "@/lib/sql-api-observability";
import { truncateWithEllipsis } from "@/lib/truncate";

export interface RunSqlResult {
  isError: boolean;
  /**
   * The rows in ClickHouse's JSONCompactEachRowWithNamesAndTypes (or the
   * error), then a note: the row count, truncation, or a hint for the next
   * query.
   */
  content: string[];
}

/**
 * Execute a read-only SQL query for an MCP connection. The org is taken from the
 * verified access-token claim. Runs the query via the tenant-scoped SQL API and
 * returns the first rows or a sanitized error string, each with a note for the
 * next query. Never throws.
 */
export async function runSqlForConnection(args: {
  orgId: string;
  metadata: unknown;
  sql: string;
}): Promise<RunSqlResult> {
  const sql = args.sql.trim();
  if (!sql) {
    return { isError: true, content: ["SQL query is required."] };
  }

  try {
    assertOrganizationProvisioned(args.metadata);
    const result = await previewSqlApi(sql, args.orgId, MCP_MAX_ROWS);
    const lines = [
      JSON.stringify(result.columns),
      JSON.stringify(result.columnTypes),
    ];
    let size = lines[0].length + lines[1].length;
    if (size > MCP_MAX_OUTPUT_CHARS) {
      return {
        isError: true,
        content: [
          `The column names and types alone exceed ${MCP_MAX_OUTPUT_CHARS} chars. Select fewer columns or shorter aliases.`,
        ],
      };
    }
    for (const row of result.rows) {
      const line = `[${row.map(cellJson).join(",")}]`;
      size += line.length + 1;
      if (size > MCP_MAX_OUTPUT_CHARS) break;
      lines.push(line);
    }
    const shown = lines.length - 2;
    return {
      isError: false,
      content: [
        lines.join("\n"),
        resultNote(shown, result.truncated || shown < result.rows.length),
      ],
    };
  } catch (error) {
    const hint = errorHint(error);
    return {
      isError: true,
      content: [sanitizeSqlApiError(error), ...(hint ? [hint] : [])],
    };
  }
}

function resultNote(shown: number, truncated: boolean): string {
  if (truncated) {
    return `First ${rowCount(shown)} shown; the result had more. Aggregate, select fewer columns, or add a smaller LIMIT.`;
  }
  if (shown === 0) {
    return "0 rows. Widen the time window, check the ServiceName spelling, and check freshness with max(Timestamp) (TimeUnix on metrics_*) grouped by ServiceName.";
  }
  return `${rowCount(shown)}.`;
}

function rowCount(n: number): string {
  return `${n} ${n === 1 ? "row" : "rows"}`;
}

// Serialize a cell once; only a cell over the cap is cut. JSON and Map columns
// arrive as objects and are cut as their JSON text.
function cellJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json.length <= MCP_MAX_CELL_CHARS) return json;
  const text = typeof value === "string" ? value : json;
  const cut = truncateWithEllipsis(text, MCP_MAX_CELL_CHARS);
  const omitted = text.length - (cut.length - 1); // the ellipsis is not kept text
  return JSON.stringify(`${cut}[+${omitted} chars]`);
}

const SCHEMA_HINT =
  "Run DESCRIBE TABLE <table> for columns. List attribute keys with SELECT arrayJoin(SpanAttributesKeys) AS key, count() FROM traces WHERE Timestamp > now() - INTERVAL 1 HOUR GROUP BY key LIMIT 100.";
const NARROW_SCAN_HINT =
  "Narrow the time window and filter on ServiceName (the sort key).";

const ERROR_HINTS: Record<string, string> = {
  UNKNOWN_IDENTIFIER: SCHEMA_HINT,
  NO_SUCH_COLUMN_IN_TABLE: SCHEMA_HINT,
  TOO_MANY_ROWS_OR_BYTES:
    "The result is too large. Aggregate, select fewer columns, or add LIMIT.",
  TOO_MANY_ROWS: NARROW_SCAN_HINT,
  TOO_MANY_BYTES: NARROW_SCAN_HINT,
};

// Grouping by or comparing a raw JSON attribute fails with a message that names
// the Dynamic type; its error type is shared with unrelated failures.
const DYNAMIC_HINT =
  "Attribute values are Dynamic. Wrap them: toString(SpanAttributes.`key`), or toFloat64OrZero(toString(...)) for numbers.";

function errorHint(error: unknown): string | undefined {
  if (!(error instanceof ClickHouseError)) return undefined;
  if (classifyCloudQueryError(error).kind === "timeout")
    return NARROW_SCAN_HINT;
  return (
    ERROR_HINTS[error.type ?? ""] ??
    (error.message.includes("Dynamic") ? DYNAMIC_HINT : undefined)
  );
}
