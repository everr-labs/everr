-- Development only: let self-hosted read the shared database without changing
-- Cloud's users, tenant policies, SQL role, or quota. Passwords are disposable.
CREATE USER IF NOT EXISTS self_hosted_app_ro
  IDENTIFIED WITH sha256_password BY 'app-dev';
CREATE USER IF NOT EXISTS self_hosted_sql_api
  IDENTIFIED WITH sha256_password BY 'sql-api-dev'
  SETTINGS PROFILE 'sql_api_profile';

-- These policies apply only to the two self-hosted development users.
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_traces ON app.traces
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_logs ON app.logs
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_metrics_gauge ON app.metrics_gauge
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_metrics_sum ON app.metrics_sum
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_metrics_histogram ON app.metrics_histogram
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_metrics_exponential_histogram ON app.metrics_exponential_histogram
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_metrics_summary ON app.metrics_summary
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_alert_events ON app.alert_events
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;
CREATE ROW POLICY IF NOT EXISTS self_hosted_dev_traces_trace_id_ts ON app.traces_trace_id_ts
  FOR SELECT USING 1 TO self_hosted_app_ro, self_hosted_sql_api;

GRANT SELECT ON app.* TO self_hosted_app_ro;
-- Keep the SQL API limited to the same tables as sql_api_role.
GRANT SELECT ON app.traces TO self_hosted_sql_api;
GRANT SELECT ON app.logs TO self_hosted_sql_api;
GRANT SELECT ON app.metrics_gauge TO self_hosted_sql_api;
GRANT SELECT ON app.metrics_sum TO self_hosted_sql_api;
GRANT SELECT ON app.metrics_histogram TO self_hosted_sql_api;
GRANT SELECT ON app.metrics_exponential_histogram TO self_hosted_sql_api;
GRANT SELECT ON app.metrics_summary TO self_hosted_sql_api;
GRANT SELECT ON app.alert_events TO self_hosted_sql_api;
GRANT SELECT ON app.traces_trace_id_ts TO self_hosted_sql_api;
CREATE QUOTA IF NOT EXISTS self_hosted_dev_sql_api_quota KEYED BY user_name
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO self_hosted_sql_api;
