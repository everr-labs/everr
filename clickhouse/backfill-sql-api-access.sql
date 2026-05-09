-- Manual backfill for ClickHouse volumes created before the /sql API access
-- entities existed.
--
-- Before running, replace the password placeholder below. Then run with an
-- access-management admin user, for example:
--
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/backfill-sql-api-access.sql
--
-- This file intentionally does not create per-org sql_api_org_* users. Those
-- are provisioned at org creation (auth.server.ts) and re-provisioned for any
-- pre-existing orgs by the startup backfill in sql-api-org-user-backfill.ts.

CREATE DATABASE IF NOT EXISTS otel;
CREATE DATABASE IF NOT EXISTS app;

CREATE USER IF NOT EXISTS collector_rw IDENTIFIED WITH sha256_password BY '<COLLECTOR_RW_PASSWORD>';
CREATE USER IF NOT EXISTS app_ro IDENTIFIED WITH sha256_password BY '<APP_RO_PASSWORD>';
CREATE USER IF NOT EXISTS web_app_admin IDENTIFIED WITH sha256_password BY '<WEB_APP_ADMIN_PASSWORD>';

-- Collector writes raw telemetry into otel schema.
GRANT SELECT, INSERT, CREATE TABLE, ALTER TABLE ON otel.* TO collector_rw;

-- App reads only curated read-model tables.
GRANT SELECT ON app.* TO app_ro;

-- App admin writes retention rows and provisions per-org access entities for
-- the /sql API.
GRANT INSERT, SELECT ON app.tenant_retention_source TO web_app_admin;
GRANT CREATE USER, ALTER USER, DROP USER ON *.* TO web_app_admin;
GRANT CREATE ROW POLICY, DROP ROW POLICY ON app.* TO web_app_admin;

-- dictGet is needed wherever the TTL expression evaluates dictGetOrDefault.
GRANT dictGet ON app.tenant_retention TO collector_rw;
GRANT dictGet ON app.tenant_retention TO app_ro;

-- Settings profile: hard caps for the /sql API. All READONLY so per-query
-- SETTINGS clauses cannot loosen them.
CREATE SETTINGS PROFILE IF NOT EXISTS sql_api_profile SETTINGS
  readonly = 1 READONLY,
  max_execution_time = 30 READONLY,
  max_memory_usage = 5000000000 READONLY,
  max_memory_usage_for_user = 10000000000 READONLY,
  max_rows_to_read = 1000000000 READONLY,
  max_bytes_to_read = 100000000000 READONLY,
  read_overflow_mode = 'throw' READONLY,
  max_result_rows = 1000 READONLY,
  max_result_bytes = 1048576 READONLY,
  result_overflow_mode = 'throw' READONLY,
  max_threads = 8 READONLY,
  max_concurrent_queries_for_user = 20 READONLY,
  max_network_bandwidth = 50000000 READONLY,
  max_network_bandwidth_for_user = 100000000 READONLY,
  max_ast_elements = 10000 READONLY,
  max_expanded_ast_elements = 100000 READONLY,
  max_query_size = 262144 READONLY,
  timeout_before_checking_execution_speed = 10 READONLY,
  min_execution_speed = 1000000 READONLY,
  allow_ddl = 0 READONLY,
  allow_introspection_functions = 0 READONLY;

-- Role: SELECT only on tenant-scoped read tables. Per-org users are granted
-- this role at provision time.
CREATE ROLE IF NOT EXISTS sql_api_role SETTINGS PROFILE 'sql_api_profile';
GRANT SELECT ON app.traces        TO sql_api_role;
GRANT SELECT ON app.logs          TO sql_api_role;
GRANT SELECT ON app.metrics_gauge TO sql_api_role;
GRANT SELECT ON app.metrics_sum   TO sql_api_role;

-- Clean up accidental/manual system grants. SHOW TABLES handles schema
-- discovery without exposing storage counters from system.tables or the
-- shared quota counter from system.quota_usage.
REVOKE SELECT ON system.tables FROM sql_api_role;
REVOKE SELECT ON system.quota_usage FROM sql_api_role;

-- web_app_admin needs ADMIN OPTION on sql_api_role to grant it to the per-org
-- users it provisions.
GRANT sql_api_role TO web_app_admin WITH ADMIN OPTION;

-- Keep sql_api_role out of web_app_admin's default roles so sql_api_profile
-- (readonly=1, allow_ddl=0, ...) is never auto-applied to its sessions.
-- ADMIN OPTION still lets it GRANT the role to per-org users; web_app_admin's
-- own work is covered by direct grants on the user.
ALTER USER web_app_admin DEFAULT ROLE NONE;

-- Quota: per-tenant limits. Keyed by client_key so each org gets its own
-- bucket via the X-ClickHouse-Quota header set by querySqlApi.
CREATE QUOTA OR REPLACE sql_api_quota
  KEYED BY client_key
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour   MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO sql_api_role EXCEPT web_app_admin;

-- Default-deny row policies for sql_api_role. Per-org row policies attached
-- to each sql_api_org_<id> user OR-combine with these to expose exactly one
-- tenant's rows per query.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces
  ON app.traces        FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_logs
  ON app.logs          FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_gauge
  ON app.metrics_gauge FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_sum
  ON app.metrics_sum   FOR SELECT USING 0 TO sql_api_role;
