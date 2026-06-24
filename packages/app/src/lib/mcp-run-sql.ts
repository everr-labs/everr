import { querySqlApi } from "@/lib/clickhouse";
import { McpOrgError, resolveMcpOrg } from "@/lib/mcp-org";
import { sanitizeSqlApiError } from "@/lib/sql-api-error";

export interface RunSqlResult {
  isError: boolean;
  text: string;
}

/**
 * Execute a read-only SQL query for an MCP user. Resolves their org, runs the
 * query via the tenant-scoped SQL API, and returns NDJSON rows or a sanitized
 * error string. Never throws.
 */
export async function runSqlForConnection(args: {
  userId: string;
  sql: string;
}): Promise<RunSqlResult> {
  const sql = args.sql.trim();
  if (!sql) {
    return { isError: true, text: "SQL query is required." };
  }

  let organizationId: string;
  try {
    organizationId = await resolveMcpOrg(args.userId);
  } catch (error) {
    // Never throws: a McpOrgError carries a user-facing message; any other
    // (e.g. DB) error is reported generically rather than escaping as a 500.
    return {
      isError: true,
      text:
        error instanceof McpOrgError
          ? error.message
          : "Failed to resolve your organization.",
    };
  }

  try {
    const rows = await querySqlApi<Record<string, unknown>>(
      sql,
      organizationId,
    );
    const text =
      rows.length === 0
        ? "(0 rows)"
        : rows.map((row) => JSON.stringify(row)).join("\n");
    return { isError: false, text };
  } catch (error) {
    return { isError: true, text: sanitizeSqlApiError(error) };
  }
}
