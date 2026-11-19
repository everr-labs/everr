-- Row policies for app.recordings (0013-create-recordings.sql). app_ro has
-- SELECT ON app.*, so without the tenant filter its reads are cross-tenant.
-- The table and this file apply in one startup, before the app serves a read.
CREATE ROW POLICY OR REPLACE tenant_filter_recordings
ON app.recordings
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

-- Recordings hold raw rrweb. Deny by default and never GRANT SELECT so an
-- accidental grant later stays fail-closed. Not in SQL_API_TABLES.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_recordings
  ON app.recordings FOR SELECT USING 0 TO sql_api_role;
