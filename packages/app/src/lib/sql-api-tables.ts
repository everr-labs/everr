// Tables that get a per-org row policy provisioned. Must match the read tables
// granted to sql_api_role in clickhouse/init/15-create-sql-api-role.sql. The
// canonical readable-table list: exported so callers (the MCP tool
// description, the schema-probe error) advertise exactly these instead of
// hand-syncing copies. Lives apart from the ClickHouse client so consumers of
// the list alone don't import node:crypto or the server env.
export const SQL_API_TENANT_TABLES = [
  "traces",
  "logs",
  "metrics_gauge",
  "metrics_sum",
  "metrics_histogram",
  "metrics_exponential_histogram",
  "metrics_summary",
  "alert_events",
] as const;
