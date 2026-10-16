-- Default-deny row policies for sql_api_role. Per-org row policies attached
-- to each `sql_api_org_<id>` user OR-combine with these to expose exactly
-- one tenant's rows per query. Defense in depth: if provisioning ever skips
-- the per-org policy step, the user sees zero rows rather than all rows.
--
-- They come before every grant below, and the order is load-bearing:
-- ClickHouse returns every row when no row policy applies to a user for a
-- table, so a grant that stands without its policy is a cross-tenant read for
-- as long as it stands. In this order a run that stops part way leaves the
-- table unreadable rather than readable by everyone.
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces
  ON app.traces        FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_logs
  ON app.logs          FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_gauge
  ON app.metrics_gauge FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_sum
  ON app.metrics_sum       FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_histogram
  ON app.metrics_histogram              FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_exponential_histogram
  ON app.metrics_exponential_histogram FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_metrics_summary
  ON app.metrics_summary               FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_alert_events
  ON app.alert_events  FOR SELECT USING 0 TO sql_api_role;
CREATE ROW POLICY IF NOT EXISTS sql_api_default_deny_traces_trace_id_ts
  ON app.traces_trace_id_ts            FOR SELECT USING 0 TO sql_api_role;
