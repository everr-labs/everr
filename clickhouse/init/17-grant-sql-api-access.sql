-- Cloud default-deny policies are installed first by 16-sql-api-policies.sql.
-- Self-hosted uses the same table grants without tenant filters.
GRANT SELECT ON app.traces        TO sql_api_role;
GRANT SELECT ON app.logs          TO sql_api_role;
GRANT SELECT ON app.metrics_gauge TO sql_api_role;
GRANT SELECT ON app.metrics_sum       TO sql_api_role;
GRANT SELECT ON app.metrics_histogram              TO sql_api_role;
GRANT SELECT ON app.metrics_exponential_histogram TO sql_api_role;
GRANT SELECT ON app.metrics_summary              TO sql_api_role;
GRANT SELECT ON app.alert_events  TO sql_api_role;
GRANT SELECT ON app.traces_trace_id_ts           TO sql_api_role;

-- Clean up accidental/manual system grants. SHOW TABLES handles schema
-- discovery without exposing storage counters from system.tables or the
-- shared quota counter from system.quota_usage.
REVOKE SELECT ON system.tables FROM sql_api_role;
REVOKE SELECT ON system.quota_usage FROM sql_api_role;
