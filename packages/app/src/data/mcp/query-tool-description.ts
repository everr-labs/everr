// The schema half is shared with the everr-use-telemetry skill, so the MCP tool
// and `everr cloud query` agents read the same tables, units, and recipes.
import schema from "../../../../../crates/everr-core/assets/skills/everr-use-telemetry/rules/schema.md?raw";

// The SQL API's result cap is sized for dashboards. An LLM pays for every row
// in context, so the MCP tool shows far less and says so.
export const MCP_MAX_ROWS = 200;
export const MCP_MAX_CELL_CHARS = 2000;
export const MCP_MAX_OUTPUT_CHARS = 60_000;

export const QUERY_TOOL_DESCRIPTION = `Run one read-only ClickHouse SQL query (SELECT, WITH, DESCRIBE, SHOW, EXPLAIN) over your organization's OpenTelemetry data. A row policy already scopes rows to your organization: never filter on a tenant.

Output is ClickHouse's JSONCompactEachRowWithNamesAndTypes: a line of column names, a line of column types, then one JSON array per row. 64-bit integers come back as strings. At most ${MCP_MAX_ROWS} rows and about ${MCP_MAX_OUTPUT_CHARS / 1000}k chars are returned, and values longer than ${MCP_MAX_CELL_CHARS} chars are cut (read the rest with substring()). Queries time out after 30 seconds. A second text block gives the row count or a hint for the next query.

${schema}`;
