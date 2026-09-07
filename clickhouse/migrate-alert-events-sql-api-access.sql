-- One-shot migration for an existing cloud ClickHouse: gives the /sql API role
-- read access to app.alert_events, matching init/15-create-sql-api-role.sql.
-- Run after clickhouse/migrate-alert-events-final-shape.sql, which creates the
-- table this grants on.
--
-- Apply with an admin user, e.g.:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/migrate-alert-events-sql-api-access.sql
--
-- Every statement is self-contained: the settings a statement needs ride on
-- its own SETTINGS clause rather than a session-level SET, so this also
-- applies cleanly through a runner that sends one query per request. Nothing
-- here needs a setting.
--
-- The per-organization row policies are the third part of the tenancy
-- template. New organizations get theirs from provisionSqlApiOrgUser in
-- packages/app/src/lib/clickhouse.ts. Organizations provisioned before this
-- migration have none, and the default-deny policy below means they read zero
-- rows (a wrong answer, not an error), so the backfill at the bottom is not
-- optional.

-- The default-deny policy comes first, and the order is load-bearing:
-- ClickHouse returns every row when no row policy applies to a user for a
-- table, so granting first opens a window in which every provisioned
-- sql_api_org_* user reads every tenant's alert history. The window lasts
-- until the next statement, and this file's stated audience is a runner that
-- sends one query per request, which can stop between the two.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_alert_events
  ON app.alert_events FOR SELECT USING 0 TO sql_api_role;

GRANT SELECT ON app.alert_events TO sql_api_role;

-- MANDATORY SECOND STEP, not documentation: the query below is a SELECT that
-- GENERATES CREATE ROW POLICY statements as text; it does not run them. A
-- one-query-per-request runner (this migration's own stated audience) will
-- execute the SELECT and discard its output, leaving every pre-existing org
-- on the default-deny policy above: they will read zero rows from
-- app.alert_events, silently, not an error. Copy the `statement` column from
-- this query's output and execute it, statement by statement, with the same
-- admin client, before considering this migration done. The verification
-- query further down confirms whether that step happened.
--
-- Backfill for organizations that already have a /sql API user. This prints
-- one CREATE ROW POLICY statement per existing user; run the output with the
-- same admin client. The statements match provisionSqlApiOrgUser exactly, and
-- they are IF NOT EXISTS, so re-running is harmless.
SELECT concat(
    'CREATE ROW POLICY IF NOT EXISTS `', name, '_alert_events` ',
    'ON app.`alert_events` FOR SELECT USING tenant_id = ''',
    substring(name, length('sql_api_org_') + 1), ''' TO `', name, '`;'
  ) AS statement
FROM system.users
WHERE name LIKE 'sql\_api\_org\_%'
ORDER BY name
FORMAT TSVRaw;

-- Verification: run this after executing the backfill statements above.
-- Every sql_api_org_% user should have exactly one row policy on
-- app.alert_events, so org_alert_events_policies should equal org_users.
-- A lower count means the backfill step was skipped or only partially run;
-- re-run the SELECT above and execute the statements for the missing users.
SELECT
    (SELECT count() FROM system.users WHERE name LIKE 'sql\_api\_org\_%') AS org_users,
    (SELECT count() FROM system.row_policies
       WHERE database = 'app' AND table = 'alert_events'
         AND short_name LIKE 'sql\_api\_org\_%\_alert\_events') AS org_alert_events_policies
FORMAT TSVRaw;
-- Expected result: org_alert_events_policies = org_users.
