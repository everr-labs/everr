-- Tenant filter for app_ro: reads the tenant id from a per-query setting the
-- app injects via clickhouse_settings. The /sql API uses sql_api_role with its
-- own per-org row policies (see 15-create-sql-api-role.sql) — those provide
-- isolation against attacker-controlled SQL, which app_ro's setting-based
-- policy cannot under readonly=0.
DROP ROW POLICY IF EXISTS tenant_filter_traces ON app.traces;
CREATE ROW POLICY tenant_filter_traces
ON app.traces
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_logs ON app.logs;
CREATE ROW POLICY tenant_filter_logs
ON app.logs
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_metrics_gauge ON app.metrics_gauge;
CREATE ROW POLICY tenant_filter_metrics_gauge
ON app.metrics_gauge
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_metrics_sum ON app.metrics_sum;
CREATE ROW POLICY tenant_filter_metrics_sum
ON app.metrics_sum
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
