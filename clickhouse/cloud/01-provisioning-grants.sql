-- Access-management grants for /sql API per-org provisioning:
--   CREATE/ALTER/DROP USER: needed to make per-org users `sql_api_org_<id>`.
--     CH does not allow scoping user creation by name pattern.
--   CREATE/DROP ROW POLICY ON app.*: scoped to the app database. Means a
--     compromised web app could drop tenant filters — but not an escalation
--     beyond what app_ro already gives a compromised app process, since app_ro
--     can override SQL_everr_tenant_id (no readonly profile).
-- The ADMIN OPTION on sql_api_role is granted in 15-create-sql-api-role.sql
-- once the role exists, so web_app_admin can grant it to per-org users.
GRANT CREATE USER, ALTER USER, DROP USER ON *.* TO web_app_admin;
GRANT CREATE ROW POLICY, DROP ROW POLICY ON app.* TO web_app_admin;