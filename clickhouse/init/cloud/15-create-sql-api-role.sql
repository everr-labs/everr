-- Role: SELECT only on the tenant-scoped read tables. We deliberately
-- avoid `app.*` so a future internal table with no row policy does not
-- auto-expand the surface area.
-- Per-org users `sql_api_org_<id>` are granted this role at provision time.
CREATE ROLE IF NOT EXISTS sql_api_role SETTINGS PROFILE 'sql_api_profile';
-- Default-deny row policies for sql_api_role. Per-org row policies attached
-- to each `sql_api_org_<id>` user OR-combine with these to expose exactly
-- one tenant's rows per query. Defense in depth: if provisioning ever skips
-- the per-org policy step, the user sees zero rows rather than all rows.
--
-- They come before every grant below, and the order is load-bearing:
-- ClickHouse returns every row when no row policy applies to a user for a
-- table, so a grant that stands without its policy is a cross-tenant read for
-- as long as it stands. In this order a run that stops part way leaves the
-- table unreadable rather than readable by everyone.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces
  ON app.traces        FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_logs
  ON app.logs          FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_gauge
  ON app.metrics_gauge FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_sum
  ON app.metrics_sum       FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_histogram
  ON app.metrics_histogram              FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_exponential_histogram
  ON app.metrics_exponential_histogram FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_summary
  ON app.metrics_summary               FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_alert_events
  ON app.alert_events  FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces_trace_id_ts
  ON app.traces_trace_id_ts            FOR SELECT USING 0 TO sql_api_role;
-- Recordings hold session replay bodies. The policy exists so a later SELECT
-- grant cannot expose every tenant: ClickHouse returns every row when no row
-- policy applies. Do not grant app.recordings to sql_api_role, and do not add
-- it to SQL_API_TENANT_TABLES.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_recordings
  ON app.recordings FOR SELECT USING 0 TO sql_api_role;

GRANT SELECT ON app.traces        TO sql_api_role;
GRANT SELECT ON app.logs          TO sql_api_role;
GRANT SELECT ON app.metrics_gauge TO sql_api_role;
GRANT SELECT ON app.metrics_sum       TO sql_api_role;
GRANT SELECT ON app.metrics_histogram              TO sql_api_role;
GRANT SELECT ON app.metrics_exponential_histogram TO sql_api_role;
GRANT SELECT ON app.metrics_summary              TO sql_api_role;
-- Tenancy template, copy all three parts for every future alerting object: the
-- default-deny row policy above, the SELECT grant here, and the table name in
-- SQL_API_TENANT_TABLES
-- (packages/app/src/lib/sql-api-tables.ts), which provisions the per-
-- organization row policy and advertises the table to callers. If any one of
-- the three is missing, the table is either unreachable or readable across
-- tenants. Organizations provisioned before the new entry also need a policy
-- backfill during the deployment cut-over.
-- app.recordings is the exception: default-deny above, and no SELECT grant.
GRANT SELECT ON app.alert_events  TO sql_api_role;
GRANT SELECT ON app.traces_trace_id_ts           TO sql_api_role;

-- Clean up accidental/manual system grants. SHOW TABLES handles schema
-- discovery without exposing storage counters from system.tables or the
-- shared quota counter from system.quota_usage.
REVOKE SELECT ON system.tables FROM sql_api_role;
REVOKE SELECT ON system.quota_usage FROM sql_api_role;

-- web_app_admin needs ADMIN OPTION on sql_api_role to grant it to the per-org
-- users it provisions. Granted here (not in 00-setup.sh) because the role
-- doesn't exist yet at that point in the boot order.
GRANT sql_api_role TO web_app_admin WITH ADMIN OPTION;

-- Keep sql_api_role out of web_app_admin's default roles. Otherwise CH would
-- auto-activate it on every connection and apply sql_api_profile (readonly=1,
-- allow_ddl=0, etc.) to web_app_admin's sessions, which would break the
-- CREATE USER / GRANT / CREATE ROW POLICY work it has to do. The app code
-- uses SET ROLE to activate it only for the GRANT statement.
ALTER USER web_app_admin DEFAULT ROLE NONE;

-- Quota: per-tenant limits. Keyed by client_key so each org gets its own
-- bucket via the X-ClickHouse-Quota header (querySqlApi in
-- packages/app/src/lib/clickhouse.ts sets it to the per-org username). The CH
-- client never propagates a header from user input, so the key is not
-- attacker-controlled. OR REPLACE so the keying change applies on fresh init
-- even when the quota name was already created by an earlier image.
CREATE QUOTA OR REPLACE sql_api_quota
  KEYED BY client_key
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour   MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO sql_api_role EXCEPT web_app_admin;
