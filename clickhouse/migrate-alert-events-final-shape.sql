-- One-shot migration for an existing cloud ClickHouse: recreates
-- app.alert_events in its final shape (init/12-create-alert-events.sql) and
-- drops the legacy app.logs projection. PARTITION BY and ORDER BY are immutable,
-- so this is a drop-and-recreate; losing pre-recreation alert history is
-- accepted for this release stage (04-alerting-branch-review.md, "Breaking
-- Postgres migration" applies the same stance to alerting data).
--
-- DO NOT RE-RUN once this has been applied and
-- migrate-alert-events-sql-api-access.sql's backfill has run: DROP TABLE
-- below discards every row collected since the last run, including from
-- organizations the backfill just gave read access to. The statements are
-- IF EXISTS / IF NOT EXISTS for a clean first apply, not for safe repetition.
--
-- Apply with an admin user, e.g.:
--   clickhouse-client --user default --password '<ADMIN_PASSWORD>' --multiquery \
--     < clickhouse/migrate-alert-events-final-shape.sql
--
-- Every statement is self-contained: the settings a statement needs ride on
-- its own SETTINGS clause rather than a session-level SET, so this also
-- applies cleanly through a runner that sends one query per request. The
-- CREATE TABLE carries allow_suspicious_ttl_expressions for its
-- dictGetOrDefault TTL alongside its MergeTree settings.

-- The legacy view copied every alert event into app.logs. Nothing consumes
-- those rows: alert history is read from the typed table only.
DROP VIEW IF EXISTS app.alert_events_logs_mv;

DROP TABLE IF EXISTS app.alert_events;

CREATE TABLE app.alert_events
(
  event_id UUID DEFAULT generateUUIDv7(),
  notification_event_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  episode_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  tenant_id LowCardinality(String),
  alert_definition_id UUID,
  repoid LowCardinality(String),
  slug LowCardinality(String),
  preview_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  is_live Bool DEFAULT preview_id = toUUID('00000000-0000-0000-0000-000000000000'),
  event_type LowCardinality(String),
  write_source LowCardinality(String) DEFAULT 'live',
  evaluation_scheduled_at DateTime64(3) DEFAULT toDateTime64(0, 3) CODEC(Delta, ZSTD(1)),
  event_time DateTime64(3) DEFAULT now64(3) CODEC(Delta, ZSTD(1)),
  row_count UInt64 DEFAULT 0,
  evidence_truncated Bool DEFAULT false,
  evidence_json String DEFAULT '{}' CODEC(ZSTD(6)),
  samples_truncated Bool DEFAULT false,
  samples_json String DEFAULT '[]' CODEC(ZSTD(6)),
  context_json String DEFAULT '{}' CODEC(ZSTD(6)),
  error String DEFAULT '',
  instance_fingerprint String DEFAULT '',
  instance_labels Map(LowCardinality(String), String) DEFAULT map(),
  service_name LowCardinality(String) DEFAULT 'alert',
  severity LowCardinality(String) DEFAULT 'info',
  rule_muted Bool DEFAULT false,
  reason LowCardinality(String) DEFAULT '',
  silenced Bool DEFAULT false,
  silence_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
  silence_comment String DEFAULT '',
  silence_matchers_json String DEFAULT '',
  delivery_targets Map(String, Array(String)) DEFAULT map(),
  delivery_dedup_key String DEFAULT '',
  INDEX alert_def_skip_idx alert_definition_id TYPE bloom_filter GRANULARITY 4,
  INDEX alert_notification_skip_idx notification_event_id TYPE bloom_filter GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY (toYYYYMM(event_time), event_type IN ('evaluation_succeeded', 'evaluation_failed'))
ORDER BY (tenant_id, repoid, slug, event_type, event_time, event_id)
TTL toDateTime(event_time) + INTERVAL least(toUInt32(30), dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(3650))) DAY DELETE WHERE event_type IN ('evaluation_succeeded', 'evaluation_failed'),
    toDateTime(event_time) + INTERVAL dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(3650)) DAY DELETE WHERE event_type NOT IN ('evaluation_succeeded', 'evaluation_failed')
SETTINGS index_granularity = 8192, non_replicated_deduplication_window = 10000, allow_suspicious_ttl_expressions = 1;

GRANT SELECT ON app.alert_events TO app_ro;

GRANT INSERT, SELECT ON app.alert_events TO web_app_admin;

GRANT dictGet ON app.tenant_retention TO web_app_admin;

DROP ROW POLICY IF EXISTS tenant_filter_alert_events ON app.alert_events;

CREATE ROW POLICY tenant_filter_alert_events
ON app.alert_events
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;
