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

DROP ROW POLICY IF EXISTS tenant_filter_workflow_resource_usage_samples ON app.workflow_resource_usage_samples;
CREATE ROW POLICY tenant_filter_workflow_resource_usage_samples
ON app.workflow_resource_usage_samples
FOR SELECT
USING tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))
TO app_ro;

DROP ROW POLICY IF EXISTS tenant_filter_workflow_resource_usage_job_summaries ON app.workflow_resource_usage_job_summaries;
CREATE ROW POLICY tenant_filter_workflow_resource_usage_job_summaries
ON app.workflow_resource_usage_job_summaries
FOR SELECT
USING tenant_id = toUInt64(getSetting('SQL_everr_tenant_id'))
TO app_ro;
