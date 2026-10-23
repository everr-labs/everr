-- Installation-wide access to the public read tables. Keep the allowlist
-- explicit so future internal tables are not exposed automatically.
CREATE ROLE IF NOT EXISTS sql_api_role SETTINGS PROFILE 'sql_api_profile';

GRANT SELECT ON app.traces        TO sql_api_role;
GRANT SELECT ON app.logs          TO sql_api_role;
GRANT SELECT ON app.metrics_gauge TO sql_api_role;
GRANT SELECT ON app.metrics_sum       TO sql_api_role;
GRANT SELECT ON app.metrics_histogram              TO sql_api_role;
GRANT SELECT ON app.metrics_exponential_histogram TO sql_api_role;
GRANT SELECT ON app.metrics_summary              TO sql_api_role;
GRANT SELECT ON app.alert_events  TO sql_api_role;
GRANT SELECT ON app.traces_trace_id_ts           TO sql_api_role;

GRANT sql_api_role TO sql_api;
ALTER USER sql_api DEFAULT ROLE sql_api_role;

-- All SQL API callers share this installation's user-based quota.
CREATE QUOTA OR REPLACE sql_api_quota
  KEYED BY user_name
  FOR INTERVAL 1 minute MAX queries = 120, errors = 20,
  FOR INTERVAL 1 hour MAX queries = 2400, read_rows = 20000000000, execution_time = 1200
  TO sql_api_role;
