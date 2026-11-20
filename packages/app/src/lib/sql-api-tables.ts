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

// A table the role reads through a column grant, not a whole-table one. Every
// column of the table is readable except the ones left out here. For
// recordings that is Body: raw rrweb, megabytes per row, with page text in it.
// The grants in 0014-cloud-recordings-rls.sql and
// 0015-self-hosted-recordings-sql-api-grant.sql spell this list out, and
// sql-api-tables.test.ts keeps them equal. Schema discovery documents these
// columns and no others.
export const SQL_API_TABLE_COLUMNS = {
  recordings: [
    "Timestamp",
    "TraceId",
    "SpanId",
    "TraceFlags",
    "SeverityText",
    "SeverityNumber",
    "ServiceName",
    "ResourceSchemaUrl",
    "ResourceAttributes",
    "ResourceAttributesKeys",
    "ScopeSchemaUrl",
    "ScopeName",
    "ScopeVersion",
    "ScopeAttributes",
    "ScopeAttributesKeys",
    "LogAttributes",
    "LogAttributesKeys",
    "EventName",
    "tenant_id",
    "retention_days",
    "session_id",
    "stream_id",
    "segment_index",
    "segment_end",
    "clip_start",
    "clip_id",
    "trigger",
    "truncated",
  ],
} as const satisfies Partial<Record<SqlApiTable, readonly string[]>>;
