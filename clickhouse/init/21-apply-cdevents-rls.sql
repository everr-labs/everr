DROP ROW POLICY IF EXISTS tenant_filter_cdevents ON app.cdevents;
CREATE ROW POLICY tenant_filter_cdevents
ON app.cdevents
FOR SELECT
USING tenant_id = toUInt64(getSetting('SQL_citric_tenant_id'))
TO app_ro;
