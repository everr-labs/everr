#!/bin/bash
set -eu
: "${CLICKHOUSE_SQL_API_PASSWORD:?CLICKHOUSE_SQL_API_PASSWORD is required}"
username="${CLICKHOUSE_SQL_API_USERNAME:-sql_api}"
[[ "$username" =~ ^[a-zA-Z0-9_]+$ ]] || { echo 'Invalid SQL API username' >&2; exit 1; }
password="${CLICKHOUSE_SQL_API_PASSWORD//\\/\\\\}"
password="${password//\'/\\\'}"
clickhouse-client --user "$CLICKHOUSE_USER" --password "$CLICKHOUSE_PASSWORD" --multiquery <<SQL
-- Self-hosted reads the whole installation and does not supply tenant settings.
DROP ROW POLICY IF EXISTS tenant_filter_traces ON app.traces;
DROP ROW POLICY IF EXISTS tenant_filter_logs ON app.logs;
DROP ROW POLICY IF EXISTS tenant_filter_metrics_gauge ON app.metrics_gauge;
DROP ROW POLICY IF EXISTS tenant_filter_metrics_sum ON app.metrics_sum;
DROP ROW POLICY IF EXISTS tenant_filter_metrics_histogram ON app.metrics_histogram;
DROP ROW POLICY IF EXISTS tenant_filter_metrics_exponential_histogram ON app.metrics_exponential_histogram;
DROP ROW POLICY IF EXISTS tenant_filter_metrics_summary ON app.metrics_summary;
DROP ROW POLICY IF EXISTS tenant_filter_traces_trace_id_ts ON app.traces_trace_id_ts;
DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;

DROP ROW POLICY IF EXISTS sql_api_default_deny_traces ON app.traces;
DROP ROW POLICY IF EXISTS sql_api_default_deny_logs ON app.logs;
DROP ROW POLICY IF EXISTS sql_api_default_deny_metrics_gauge ON app.metrics_gauge;
DROP ROW POLICY IF EXISTS sql_api_default_deny_metrics_sum ON app.metrics_sum;
DROP ROW POLICY IF EXISTS sql_api_default_deny_metrics_histogram ON app.metrics_histogram;
DROP ROW POLICY IF EXISTS sql_api_default_deny_metrics_exponential_histogram ON app.metrics_exponential_histogram;
DROP ROW POLICY IF EXISTS sql_api_default_deny_metrics_summary ON app.metrics_summary;
DROP ROW POLICY IF EXISTS sql_api_default_deny_traces_trace_id_ts ON app.traces_trace_id_ts;
DROP ROW POLICY IF EXISTS sql_api_default_deny_alert_events ON app.alert_events;

-- The self-hosted app writes history but does not provision per-org SQL users.
REVOKE CREATE USER, ALTER USER, DROP USER ON *.* FROM web_app_admin;
REVOKE CREATE ROW POLICY, DROP ROW POLICY ON app.* FROM web_app_admin;
REVOKE sql_api_role FROM web_app_admin;

CREATE USER IF NOT EXISTS \`$username\` IDENTIFIED WITH sha256_password BY '$password' SETTINGS PROFILE 'sql_api_profile';
GRANT sql_api_role TO \`$username\`;
ALTER USER \`$username\` DEFAULT ROLE sql_api_role;
CREATE QUOTA OR REPLACE sql_api_quota KEYED BY user_name
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO sql_api_role;
SQL
