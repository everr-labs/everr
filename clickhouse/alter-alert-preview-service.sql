-- Route preview alerts to their own service / environment in app.logs.
--
-- Adds the `preview` namespace to app.alert_events and rebuilds the
-- alert_events -> app.logs projection so preview alerts land under
-- ServiceName='alert-preview' with deployment.environment=<preview name>, while
-- live alerts stay ServiceName='alert' / deployment.environment='production'.
--
-- Run with an admin user, for example:
--
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/alter-alert-preview-service.sql
--
-- Fresh installs get this from 12-create-alert-events.sql; this script upgrades
-- deployments created before the preview column existed. Existing app.logs rows
-- are left as-is; only future inserts use the new projection.

-- ADD COLUMN re-validates the table's dictGetOrDefault TTL, which is
-- non-deterministic; the same allowance the table was created under.
SET allow_suspicious_ttl_expressions = 1;

ALTER TABLE app.alert_events
  ADD COLUMN IF NOT EXISTS preview String DEFAULT '' AFTER slug;

DROP VIEW IF EXISTS app.alert_events_logs_mv;

CREATE MATERIALIZED VIEW app.alert_events_logs_mv
TO app.logs
AS
SELECT
  toDateTime64(event_time, 9) AS Timestamp,
  toDateTime(event_time) AS TimestampTime,
  '' AS TraceId,
  '' AS SpanId,
  toUInt8(0) AS TraceFlags,
  'INFO' AS SeverityText,
  toUInt8(9) AS SeverityNumber,
  -- Preview alerts get their own service; live alerts stay 'alert'.
  if(preview = '', 'alert', 'alert-preview') AS ServiceName,
  concat('alert ', slug, ' ', event_type) AS Body,
  '' AS ResourceSchemaUrl,
  -- Env facet ('deployment.environment' resource attr): the preview name for
  -- preview alerts, 'production' for live.
  map(
    'everr.tenant.id', tenant_id,
    'deployment.environment', if(preview = '', 'production', preview)
  ) AS ResourceAttributes,
  '' AS ScopeSchemaUrl,
  'everr.alerting' AS ScopeName,
  '' AS ScopeVersion,
  map() AS ScopeAttributes,
  map(
    'alert.slug', slug,
    'alert.preview', preview,
    'alert.event_type', event_type,
    'alert.delivery_targets', toJSONString(delivery_targets),
    'alert.silenced', if(silence_id = '', 'false', 'true'),
    'alert.row_count', toString(row_count),
    'alert.evidence_truncated', toString(evidence_truncated),
    'alert.evidence_json', evidence_json,
    'alert.instance_fingerprint', instance_fingerprint,
    'alert.instance_labels', instance_labels_json
  ) AS LogAttributes,
  concat('alert.', slug, '.', event_type) AS EventName,
  -- Required for app.logs RLS and TTL; ResourceAttributes alone is not enough.
  tenant_id AS tenant_id
FROM app.alert_events;
