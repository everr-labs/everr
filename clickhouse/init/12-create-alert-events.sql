-- Immutable alert history: evaluations, instance transitions, notification
-- suppression, and delivery outcomes. PostgreSQL owns current state and
-- delivery coordination; ClickHouse owns the record of what happened, so
-- `everr cloud query` can answer alert questions without a PostgreSQL join.
SET allow_suspicious_ttl_expressions = 1;

CREATE TABLE IF NOT EXISTS app.alert_events
(
  event_id UUID DEFAULT generateUUIDv4(),
  -- Correlates the rows produced by one notification: the transition and the
  -- suppression or delivery rows that follow it in later jobs. Transitions set
  -- this to their own event_id. Evaluation rows leave it zero.
  notification_event_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  tenant_id String,
  alert_definition_id UUID,
  repoid String,
  slug String,
  preview_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  event_type LowCardinality(String),
  evaluation_scheduled_at DateTime64(3),
  event_time DateTime64(3) DEFAULT now64(3),
  event_date Date DEFAULT toDate(event_time),
  row_count UInt32 DEFAULT 0,
  evidence_truncated Bool DEFAULT false,
  evidence_json String DEFAULT '{}',
  samples_truncated Bool DEFAULT false,
  samples_json String DEFAULT '[]',
  error String DEFAULT '',
  instance_fingerprint String DEFAULT '',
  instance_labels_json String DEFAULT '{}',
  severity Enum8('info' = 1, 'warning' = 2, 'critical' = 3) DEFAULT 'info',
  suppressed Bool DEFAULT false,
  -- Notification outcome, frozen at the moment it was decided. A silence
  -- created later never rewrites what these say happened.
  silenced Bool DEFAULT false,
  inhibited Bool DEFAULT false,
  silence_id String DEFAULT '',
  -- Channel name to the targets it reached. Denormalized so a delivery trail
  -- never needs a join back to PostgreSQL. Never carries a URL, token, or
  -- address: see channelTargetLabel in delivery/history.ts.
  delivery_targets Map(String, Array(String)) DEFAULT map(),
  INDEX alert_def_skip_idx alert_definition_id TYPE bloom_filter GRANULARITY 4,
  INDEX alert_notification_skip_idx notification_event_id TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
-- Dominant read: per-alert history by tenant + repoid + slug over a time range.
-- ORDER BY is immutable, so this intentionally prioritizes alert filters over
-- date-only scans; monthly partitions handle lifecycle pruning. event_type is
-- low-cardinality and filtered in every query, so it sits before the time
-- column. alert_definition_id and notification_event_id are high-cardinality
-- and covered by bloom skip indexes instead.
ORDER BY (tenant_id, repoid, slug, event_type, event_time, event_id)
TTL toDateTime(event_time) + INTERVAL dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(3650)) DAY
SETTINGS index_granularity = 8192;

GRANT SELECT ON app.alert_events TO app_ro;
GRANT INSERT, SELECT ON app.alert_events TO web_app_admin;
GRANT dictGet ON app.tenant_retention TO web_app_admin;

DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;
CREATE ROW POLICY tenant_filter_alert_events
ON app.alert_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.alert_events_logs_mv
TO app.logs
AS
SELECT
  toDateTime64(event_time, 9) AS Timestamp,
  toDateTime(event_time) AS TimestampTime,
  '' AS TraceId,
  '' AS SpanId,
  toUInt8(0) AS TraceFlags,
  if(event_type IN ('evaluation_failed', 'delivery_failed'), 'ERROR', 'INFO') AS SeverityText,
  if(event_type IN ('evaluation_failed', 'delivery_failed'), toUInt8(17), toUInt8(9)) AS SeverityNumber,
  if(preview_id = toUUID('00000000-0000-0000-0000-000000000000'), 'alert', 'alert-preview') AS ServiceName,
  concat('alert ', slug, ' ', event_type) AS Body,
  '' AS ResourceSchemaUrl,
  map(
    'everr.tenant.id', tenant_id,
    'deployment.environment', if(preview_id = toUUID('00000000-0000-0000-0000-000000000000'), 'production', toString(preview_id))
  ) AS ResourceAttributes,
  '' AS ScopeSchemaUrl,
  'everr.alerting' AS ScopeName,
  '' AS ScopeVersion,
  map() AS ScopeAttributes,
  map(
    'alert.event_id', toString(event_id),
    'alert.notification_event_id', toString(notification_event_id),
    'alert.definition_id', toString(alert_definition_id),
    'alert.slug', slug,
    'alert.preview_id', toString(preview_id),
    'alert.event_type', event_type,
    'alert.row_count', toString(row_count),
    'alert.evidence_truncated', toString(evidence_truncated),
    'alert.evidence_json', evidence_json,
    'alert.error', error,
    'alert.instance_fingerprint', instance_fingerprint,
    'alert.instance_labels', instance_labels_json,
    'alert.suppressed', toString(suppressed),
    'alert.silenced', toString(silenced),
    'alert.inhibited', toString(inhibited),
    'alert.silence_id', silence_id,
    'alert.delivery_targets', toJSONString(delivery_targets)
  ) AS LogAttributes,
  concat('alert.', slug, '.', event_type) AS EventName,
  tenant_id AS tenant_id
FROM app.alert_events;
