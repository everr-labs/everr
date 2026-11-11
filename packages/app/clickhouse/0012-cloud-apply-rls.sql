-- Tenant filter for app_ro: reads the tenant id from a per-query setting the
-- app injects via clickhouse_settings. The /sql API uses sql_api_role with its
-- own per-org row policies (see 0009-cloud-create-sql-api-role.sql) — those provide
-- isolation against attacker-controlled SQL, which app_ro's setting-based
-- policy cannot under readonly=0.
CREATE ROW POLICY OR REPLACE tenant_filter_traces
ON app.traces
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_logs
ON app.logs
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_metrics_gauge
ON app.metrics_gauge
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_metrics_sum
ON app.metrics_sum
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_metrics_histogram
ON app.metrics_histogram
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_metrics_exponential_histogram
ON app.metrics_exponential_histogram
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_metrics_summary
ON app.metrics_summary
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_traces_trace_id_ts
ON app.traces_trace_id_ts
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE ROW POLICY OR REPLACE tenant_filter_alert_events
ON app.alert_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
