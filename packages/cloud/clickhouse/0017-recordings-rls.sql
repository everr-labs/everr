-- Row policies for app.recordings (0016-create-recordings.sql). app_ro has
-- SELECT ON app.*, so without the tenant filter its reads are cross-tenant.
-- The table and this file apply in one startup, before the app serves a read.
CREATE ROW POLICY OR REPLACE tenant_filter_recordings
ON app.recordings
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

-- The SQL API reads every column of recordings except Body (raw rrweb,
-- megabytes per row, holds page text). Content is read through the
-- /api/cli/recordings routes. It is a table grant followed by a revoke of the
-- withheld columns (SQL_API_WITHHELD_COLUMNS in
-- packages/app/src/lib/sql-api-tables.ts, which a test keeps equal to this
-- file), because a column-list grant makes ClickHouse refuse JSON subcolumn
-- reads such as LogAttributes.`url.path`. Size is still readable: length(Body)
-- works, and nothing else of Body does.
--
-- Order: the default-deny policy first, then GRANT, then REVOKE. The one
-- consequence: between the GRANT and the REVOKE, and again on any re-run
-- (GRANT SELECT restores the column), an organization can read its own Body
-- for a moment. Never another tenant's: the row policy is already in place.
-- A re-run must always run both statements, in this order. The per-
-- organization policies come from provisioning (SQL_API_TABLES).
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_recordings
  ON app.recordings FOR SELECT USING 0 TO sql_api_role;

GRANT SELECT ON app.recordings TO sql_api_role;
REVOKE SELECT(Body) ON app.recordings FROM sql_api_role;
