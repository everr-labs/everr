-- Alert event history. Canonical alert events live in app.alert_events and are
-- projected into app.logs so `everr cloud query` can query them via the
-- existing logs surface.
CREATE TABLE IF NOT EXISTS app.alert_events
(
  event_id UUID DEFAULT generateUUIDv4(),
  -- String, not UUID: application organization ids are text and the retention
  -- dictionary is keyed by tenant_id String.
  tenant_id String,
  alert_definition_id String,
  repoid String,
  slug String,
  -- Preview namespace ('' = live). Drives ServiceName / deployment.environment
  -- in the logs projection below so preview alerts land under their own service.
  preview String DEFAULT '',
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
  -- Stamped at insert time from the dictionary; see 10-create-mvs.sql for the
  -- per-row retention model. Alert history follows the tenant's logs retention.
  retention_days UInt16 DEFAULT toUInt16(dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(7))),
  INDEX alert_def_skip_idx alert_definition_id TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
-- Monthly buckets: the volume is small, so the partition count matters more
-- than dropping on the exact day. A partition is dropped once its last row
-- expires, up to a month after the first one.
PARTITION BY (toStartOfMonth(event_date), retention_days)
-- Dominant read: per-alert history by tenant + repoid + slug over a time range.
-- ORDER BY is immutable, so this intentionally prioritizes alert filters over
-- date-only scans; monthly partitions handle lifecycle pruning. event_type is
-- low-cardinality (~6 values) and filtered in every query, so it sits before
-- the time column. alert_definition_id is always filtered but higher
-- cardinality; a bloom skip index covers it.
ORDER BY (tenant_id, repoid, slug, event_type, event_time, event_id)
TTL event_date + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

GRANT SELECT ON app.alert_events TO app_ro;
GRANT INSERT, SELECT ON app.alert_events TO web_app_admin;
GRANT dictGet ON app.tenant_retention TO web_app_admin;

DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;
CREATE ROW POLICY tenant_filter_alert_events
ON app.alert_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
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
  -- Required for app.logs RLS and partitioning; ResourceAttributes alone is
  -- not enough.
  tenant_id AS tenant_id,
  retention_days
FROM app.alert_events;
