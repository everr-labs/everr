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
] as const;
