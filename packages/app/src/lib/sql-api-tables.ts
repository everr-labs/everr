// Explicit readable-table allowlist, shared with the restricted SQL role in
// clickhouse/schema/15-create-sql-api-role.sql.tpl. Row policies use this same
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
] as const;
