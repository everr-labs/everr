-- Per-tenant retention source + dictionary. App writes to the source table;
-- TTL clauses on app.* tables call dictGetOrDefault('app.tenant_retention', ...).
CREATE TABLE IF NOT EXISTS app.tenant_retention_source
(
  tenant_id String,
  traces_days UInt32,
  logs_days UInt32,
  metrics_days UInt32,
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY tenant_id;

CREATE DICTIONARY IF NOT EXISTS app.tenant_retention
(
  tenant_id String,
  traces_days UInt32,
  logs_days UInt32,
  metrics_days UInt32
)
PRIMARY KEY tenant_id
SOURCE(CLICKHOUSE(
  query 'SELECT tenant_id, traces_days, logs_days, metrics_days FROM app.tenant_retention_source FINAL'
))
LAYOUT(HASHED())
LIFETIME(MIN 60 MAX 120);

-- Traces: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.traces
ENGINE = MergeTree
PARTITION BY toDate(Timestamp)
ORDER BY (tenant_id, ServiceName, SpanName, toDateTime(Timestamp))
-- Fallback is intentionally absurdly high (10 years) so a dict outage
-- over-retains instead of silently dropping data. Over-retention self-heals
-- on the next clean TTL merge once the dict recovers; the fallback never
-- gets baked into a part.
TTL toDateTime(Timestamp) + INTERVAL dictGetOrDefault('app.tenant_retention', 'traces_days', tenant_id, toUInt32(3650)) DAY
SETTINGS index_granularity = 8192
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id
FROM otel.otel_traces
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_mv
TO app.traces
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id
FROM otel.otel_traces;

-- Logs: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.logs
ENGINE = MergeTree
PARTITION BY toDate(TimestampTime)
ORDER BY (tenant_id, ServiceName, TimestampTime, Timestamp)
TTL TimestampTime + INTERVAL dictGetOrDefault('app.tenant_retention', 'logs_days', tenant_id, toUInt32(3650)) DAY
SETTINGS index_granularity = 8192
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id
FROM otel.otel_logs
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id
FROM otel.otel_logs;

-- Metrics (Gauge): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_gauge
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDateTime(TimeUnix) + INTERVAL dictGetOrDefault('app.tenant_retention', 'metrics_days', tenant_id, toUInt32(3650)) DAY
SETTINGS index_granularity = 8192
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id
FROM otel.otel_metrics_gauge
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_gauge_mv
TO app.metrics_gauge
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id
FROM otel.otel_metrics_gauge;

-- Metrics (Sum): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_sum
ENGINE = MergeTree
PARTITION BY toDate(TimeUnix)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDateTime(TimeUnix) + INTERVAL dictGetOrDefault('app.tenant_retention', 'metrics_days', tenant_id, toUInt32(3650)) DAY
SETTINGS index_granularity = 8192
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id
FROM otel.otel_metrics_sum
WHERE 1 = 0;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_sum_mv
TO app.metrics_sum
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id
FROM otel.otel_metrics_sum;
