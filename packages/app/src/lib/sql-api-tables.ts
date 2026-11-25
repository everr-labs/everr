// Explicit readable-table allowlist, shared with the grants the migrations give
// sql_api_role. Row policies use this same list. Keeping it separate from the client lets schema
// discovery and MCP describe access without importing server credentials.
export const SQL_API_TABLES = [
  "traces",
  "logs",
  "metrics_gauge",
  "metrics_sum",
  "metrics_histogram",
  "metrics_exponential_histogram",
  "metrics_summary",
  "alert_events",
  "traces_trace_id_ts",
  "profiles",
  "recordings",
] as const;

type SqlApiTable = (typeof SQL_API_TABLES)[number];

// Columns the role is denied on a table it otherwise reads whole. For recordings
// that is Body: raw rrweb, megabytes per row, with page text in it. The
// migrations grant the table and then revoke exactly these columns
// (Cloud's 0017-recordings-rls.sql, self-hosted/0018-recordings-sql-api-grant.sql),
// and tests in both packages keep them equal. The grant is table-wide with a
// revoke, not a column list, because under a column grant ClickHouse refuses
// JSON subcolumn reads such as LogAttributes.`url.path`.
export const SQL_API_WITHHELD_COLUMNS = {
  recordings: ["Body"],
} as const satisfies Partial<Record<SqlApiTable, readonly string[]>>;
