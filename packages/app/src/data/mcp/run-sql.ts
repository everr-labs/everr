import { querySqlApi } from "@/lib/clickhouse";
import { sanitizeSqlApiError } from "@/lib/sql-api-error";

export interface RunSqlResult {
  isError: boolean;
  text: string;
}

/**
 * Execute a read-only SQL query for an MCP connection. The org is taken from the
 * verified access-token claim (no longer resolved here). Runs the query via the
 * tenant-scoped SQL API and returns NDJSON rows or a sanitized error string.
 * Never throws.
 */
export async function runSqlForConnection(args: {
  orgId: string;
  sql: string;
}): Promise<RunSqlResult> {
  const sql = args.sql.trim();
  if (!sql) {
    return { isError: true, text: "SQL query is required." };
  }

  try {
    const rows = await querySqlApi<Record<string, unknown>>(sql, args.orgId);
    const text = rows.length === 0 ? "(0 rows)" : rows.map((row) => JSON.stringify(row)).join("\n");
    return { isError: false, text };
  } catch (error) {
    return { isError: true, text: sanitizeSqlApiError(error) };
  }
}
