-- The SQL API tenant filter for app.recordings, for the whole role at once.
-- Every organization reads ClickHouse as its own user, sql_api_org_<id>
-- (sqlApiOrgUserName in packages/cloud/src/clickhouse/credentials.ts), so the
-- policy takes the tenant from the user's name. It covers the organizations
-- that exist when this file runs and every one created later: provisioning
-- writes no policy per organization for this table
-- (SQL_API_ROLE_SCOPED_TABLES in packages/app/src/lib/sql-api-tables.ts).
--
-- A user with the role and another name reads nothing: the prefix test fails.
-- The empty tenant is never readable, so a name that is only the prefix reads
-- nothing either. The default-deny policy of 0014 stays: policies OR together.
CREATE ROW POLICY IF NOT EXISTS sql_api_tenant_recordings
  ON app.recordings FOR SELECT
  USING tenant_id != ''
    AND startsWith(currentUser(), 'sql_api_org_')
    AND tenant_id = substring(currentUser(), length('sql_api_org_') + 1)
  TO sql_api_role;
