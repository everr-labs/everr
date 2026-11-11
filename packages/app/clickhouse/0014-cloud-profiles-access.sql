-- The default-deny policy comes before the grant, as in
-- 0009-cloud-create-sql-api-role.sql: per-org policies OR-combine with it, so
-- sql_api_role sees no profile rows until provisioning adds one.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_profiles
  ON app.profiles FOR SELECT USING 0 TO sql_api_role;

GRANT SELECT ON app.profiles TO sql_api_role;

CREATE ROW POLICY OR REPLACE tenant_filter_profiles
ON app.profiles
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
