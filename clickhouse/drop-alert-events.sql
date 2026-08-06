-- Remove obsolete ClickHouse alert-history objects. Alert history lives in
-- Postgres and is read by packages/app/src/data/alerts/history.server.ts.
--
-- Run with an admin user, for example:
--
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/drop-alert-events.sql

-- Stop projection writes before dropping their source table.
DROP VIEW IF EXISTS app.alert_events_logs_mv;

DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;

DROP TABLE IF EXISTS app.alert_events;

-- Keep role grants clean on clusters where the roles outlive the table.
REVOKE SELECT ON app.alert_events FROM app_ro;
REVOKE INSERT, SELECT ON app.alert_events FROM web_app_admin;
