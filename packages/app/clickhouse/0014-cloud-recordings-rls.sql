-- Row policies for app.recordings (0013-create-recordings.sql). app_ro has
-- SELECT ON app.*, so without the tenant filter its reads are cross-tenant.
-- The table and this file apply in one startup, before the app serves a read.
CREATE ROW POLICY OR REPLACE tenant_filter_recordings
ON app.recordings
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

-- The SQL API reads recordings without Body (raw rrweb, megabytes per row,
-- holds page text). Content is read through the /api/cli/recordings routes.
-- Same order as 0009: the default-deny policy first, then the grant, so a run
-- that stops part way leaves the table unreadable and never readable by
-- everyone. The per-organization policies come from provisioning
-- (SQL_API_TABLES). The column list must stay equal to
-- SQL_API_TABLE_COLUMNS.recordings in packages/app/src/lib/sql-api-tables.ts
-- (a test compares them).
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_recordings
  ON app.recordings FOR SELECT USING 0 TO sql_api_role;

GRANT SELECT(
  Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber, ServiceName,
  ResourceSchemaUrl, ResourceAttributes, ResourceAttributesKeys,
  ScopeSchemaUrl, ScopeName, ScopeVersion, ScopeAttributes, ScopeAttributesKeys,
  LogAttributes, LogAttributesKeys, EventName,
  tenant_id, retention_days, session_id, stream_id, segment_index,
  segment_end, clip_start, clip_id, trigger, truncated
) ON app.recordings TO sql_api_role;
