-- The SQL API reads recordings without Body (raw rrweb, megabytes per row,
-- holds page text). Content is read through the /api/cli/recordings routes.
-- No row policy: self-hosted has one tenant per installation. The column list
-- must stay equal to SQL_API_TABLE_COLUMNS.recordings in
-- packages/app/src/lib/sql-api-tables.ts (a test compares them).
GRANT SELECT(
  Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber, ServiceName,
  ResourceSchemaUrl, ResourceAttributes, ResourceAttributesKeys,
  ScopeSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, ScopeAttributesKeys,
  LogAttributes, LogAttributesKeys, EventName,
  tenant_id, retention_days, session_id, stream_id, segment_index,
  segment_end, clip_start, clip_id, trigger, truncated
) ON app.recordings TO sql_api_role;
