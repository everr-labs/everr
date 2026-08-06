-- Retire app.alert_events, the in-process alerting pipeline's event store.
--
-- Alert history now lives in the application Postgres database. The reader is
-- packages/app/src/data/alerts/history.server.ts.
--
-- Historical rows are NOT lost: app.alert_events_logs_mv already projected every
-- event into app.logs as it was written, and this drops only the source table and
-- the projection. What existed in app.logs before the cutover stays queryable
-- after it.
--
-- Fresh installs never create these objects (clickhouse/init/12-create-alert-events.sql
-- was removed with the cutover); this script retires them from a deployment created
-- before it. Until it runs, the MV keeps a write path into app.logs that nothing
-- owns any more, and it writes the pre-cutover attribute set (no alert.severity, no
-- alert.suppressed), which the new reader renders as empty severity.
--
-- Run with an admin user, for example:
--
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/drop-alert-events.sql

-- The projection first: dropping the source table out from under a live MV would
-- fail every insert that is still in flight against it.
DROP VIEW IF EXISTS app.alert_events_logs_mv;

DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;

DROP TABLE IF EXISTS app.alert_events;

-- The grants die with the table, but revoking explicitly keeps `SHOW GRANTS` clean
-- on clusters where the role outlives it. ClickHouse has no `REVOKE IF EXISTS`;
-- revoking a grant that is already gone is a no-op, not an error.
REVOKE SELECT ON app.alert_events FROM app_ro;
REVOKE INSERT, SELECT ON app.alert_events FROM web_app_admin;
