-- Alert event history. Canonical alert events live in app.alert_events and are
-- projected into app.logs so `everr cloud query` can query them via the
-- existing logs surface.
SET allow_suspicious_ttl_expressions = 1;

CREATE TABLE IF NOT EXISTS app.alert_events
(
  event_id UUID DEFAULT generateUUIDv4(),
  -- String, not UUID: application organization ids are text and the retention
  -- dictionary is keyed by tenant_id String.
  organization_id String,
  alert_definition_id String,
  repoid String,
  slug String,
  event_type LowCardinality(String),
  evaluation_scheduled_at DateTime64(3) DEFAULT toDateTime64(0, 3),
  event_time DateTime64(3) DEFAULT now64(3),
  event_date Date DEFAULT toDate(event_time),
  row_count UInt32 DEFAULT 0,
  evidence_truncated UInt8 DEFAULT 0,
  evidence_json String DEFAULT '{}',
  delivery_targets Map(String, Array(String)) DEFAULT map(),
  silence_id String DEFAULT '',
  instance_fingerprint String DEFAULT '',
  instance_labels_json String DEFAULT '{}',
  INDEX alert_def_skip_idx alert_definition_id TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)
-- Dominant read: per-alert history by org + repoid + slug over a time range.
-- ORDER BY is immutable, so this intentionally prioritizes alert filters over
-- date-only scans; monthly partitions handle lifecycle pruning. event_type is
-- low-cardinality (~6 values) and filtered in every query, so it sits before
-- the time column. alert_definition_id is always filtered but higher
-- cardinality; a bloom skip index covers it.
ORDER BY (organization_id, repoid, slug, event_type, event_time, event_id)
TTL toDateTime(event_time) + INTERVAL dictGetOrDefault('app.tenant_retention', 'logs_days', organization_id, toUInt32(3650)) DAY
SETTINGS index_granularity = 8192;

GRANT SELECT ON app.alert_events TO app_ro;
GRANT INSERT, SELECT ON app.alert_events TO web_app_admin;
GRANT dictGet ON app.tenant_retention TO web_app_admin;

DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;
CREATE ROW POLICY tenant_filter_alert_events
ON app.alert_events
FOR SELECT
USING organization_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

-- Fresh init path: there are no existing alert rows to backfill. The
-- incremental MV projects future app.alert_events inserts into app.logs.
CREATE MATERIALIZED VIEW IF NOT EXISTS app.alert_events_logs_mv
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
  'alert' AS ServiceName,
  concat('alert ', slug, ' ', event_type) AS Body,
  '' AS ResourceSchemaUrl,
  map('everr.tenant.id', organization_id) AS ResourceAttributes,
  '' AS ScopeSchemaUrl,
  'everr.alerting' AS ScopeName,
  '' AS ScopeVersion,
  map() AS ScopeAttributes,
  map(
    'alert.slug', slug,
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
  organization_id AS tenant_id
FROM app.alert_events;
