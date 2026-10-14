DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;
CREATE ROW POLICY tenant_filter_alert_events
ON app.alert_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
