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

GRANT SELECT ON app.alert_events TO sql_api_role;

CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_alert_events
  ON app.alert_events FOR SELECT USING 0 TO sql_api_role;

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
