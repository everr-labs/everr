DROP ROW POLICY IF EXISTS tenant_filter_traces ON app.traces;
CREATE ROW POLICY tenant_filter_traces
ON app.traces
FOR SELECT
USING tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))
TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_logs ON app.logs;
CREATE ROW POLICY tenant_filter_logs
ON app.logs
FOR SELECT
USING tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))
TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_metrics_gauge ON app.metrics_gauge;
CREATE ROW POLICY tenant_filter_metrics_gauge
ON app.metrics_gauge
FOR SELECT
USING tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))
TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_metrics_sum ON app.metrics_sum;
CREATE ROW POLICY tenant_filter_metrics_sum
ON app.metrics_sum
FOR SELECT
USING tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))
TO app_ro;
