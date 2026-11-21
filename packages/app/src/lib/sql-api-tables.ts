// Explicit readable-table allowlist, shared with the restricted SQL role in
// packages/app/clickhouse/0009-cloud-create-sql-api-role.sql. Row policies use this same
// list. Keeping it separate from the client lets schema
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
  "recordings",
] as const;

type SqlApiTable = (typeof SQL_API_TABLES)[number];

// Tables whose SQL API tenant filter is one row policy for the whole role. The
// policy reads the tenant from the organization user's name, so it needs no
// statement per organization and covers the ones that already exist
// (0016-cloud-recordings-sql-api-tenant-policy.sql). Provisioning writes a
// policy per organization for every other table.
export const SQL_API_ROLE_SCOPED_TABLES = ["recordings"] as const satisfies readonly SqlApiTable[];

// Columns the role is denied on a table it otherwise reads whole. For recordings
// that is Body: raw rrweb, megabytes per row, with page text in it. The
// migrations grant the table and then revoke exactly these columns
// (0014-cloud-recordings-rls.sql, 0015-self-hosted-recordings-sql-api-grant.sql),
// and sql-api-tables.test.ts keeps them equal. The grant is table-wide with a
// revoke, not a column list, because under a column grant ClickHouse refuses
// JSON subcolumn reads such as LogAttributes.`url.path`.
export const SQL_API_WITHHELD_COLUMNS = {
  recordings: ["Body"],
} as const satisfies Partial<Record<SqlApiTable, readonly string[]>>;
