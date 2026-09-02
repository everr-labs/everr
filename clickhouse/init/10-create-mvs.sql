-- Per-row retention. Every app.* row is stamped with `retention_days` by its
-- materialized view from the app.tenant_retention dictionary. A tenant without
-- a row gets the free tier, which is the dictionary row with tenant_id ''.
-- The table partitions by (day, retention_days) and the TTL is
-- `day + retention_days` with ttl_only_drop_parts = 1. Every row in a partition
-- expires on the same day, so ClickHouse drops whole parts and never rewrites
-- one to expire a single tenant. A retention change applies to rows ingested
-- from that point on. Every distinct retention value costs that many live
-- partitions per table, so the app only writes the values of a tier
-- (RETENTION_BY_TIER in packages/app/src/lib/retention.ts).
--
-- Only the views write these tables. A direct INSERT that omits retention_days
-- gets 0, and `day + 0` is already past, so the TTL drops the rows at insert.

-- Per-tenant retention source + dictionary. The app writes to the source
-- table; the materialized views below read the dictionary with
-- dictGetOrDefault to stamp retention_days on every inserted row. A plan
-- change reaches new rows once the dictionary refreshes (LIFETIME below).
CREATE TABLE IF NOT EXISTS app.tenant_retention_source
(
  tenant_id String,
  traces_days UInt16,
  logs_days UInt16,
  metrics_days UInt16,
  updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY tenant_id;

CREATE DICTIONARY IF NOT EXISTS app.tenant_retention
(
  tenant_id String,
  traces_days UInt16,
  logs_days UInt16,
  metrics_days UInt16
)
PRIMARY KEY tenant_id
SOURCE(CLICKHOUSE(
  user 'web_app_admin'
  password 'web-app-admin-dev'
  query 'SELECT tenant_id, traces_days, logs_days, metrics_days FROM app.tenant_retention_source FINAL'
))
LAYOUT(HASHED())
LIFETIME(MIN 60 MAX 120);

-- Free-tier row, keyed by the empty tenant id. The views fall back to it for
-- tenants without a row, and dictGet on a missing key throws, so it must exist
-- before the first insert. The app rewrites it from RETENTION_BY_TIER.free
-- (packages/app/src/lib/retention.ts) at every start, so that file is the
-- source of truth and these values only bootstrap a fresh cluster.
INSERT INTO app.tenant_retention_source (tenant_id, traces_days, logs_days, metrics_days) VALUES ('', 14, 14, 14);
SYSTEM RELOAD DICTIONARY app.tenant_retention;

-- Traces: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.traces
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
ORDER BY (tenant_id, ServiceName, SpanName, toDateTime(Timestamp))
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_traces
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_traces. CREATE TABLE ... AS SELECT copies
-- columns but not indexes, so app.traces starts bare; add the same set the raw
-- table carries so app-side queries prune the same way.
ALTER TABLE app.traces
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_duration Duration TYPE minmax GRANULARITY 1;

-- Codecs mirrored from otel.otel_traces. CREATE TABLE ... AS SELECT copies
-- types but not codecs, so without this every column falls back to LZ4 and the
-- table is about twice the size of the raw copy. Keep in step with
-- 03-create-otel-tables.sql; every app.* table below repeats this for its
-- own source.
ALTER TABLE app.traces
  MODIFY COLUMN `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TraceId` String CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanId` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ParentSpanId` String CODEC(ZSTD(1)),
  MODIFY COLUMN `TraceState` String CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanKind` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` String CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Duration` UInt64 CODEC(ZSTD(1)),
  MODIFY COLUMN `StatusCode` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `StatusMessage` String CODEC(ZSTD(1)),
  MODIFY COLUMN `Events.Timestamp` Array(DateTime64(9)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Events.Name` Array(LowCardinality(String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Events.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.TraceId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.SpanId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.TraceState` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.Attributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_mv
TO app.traces
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id,
  dictGetOrDefault('app.tenant_retention', 'traces_days', ResourceAttributes['everr.tenant.id'], dictGet('app.tenant_retention', 'traces_days', '')) AS retention_days
FROM otel.otel_traces;

-- Logs: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.logs
ENGINE = MergeTree
PARTITION BY (toDate(TimestampTime), retention_days)
ORDER BY (tenant_id, ServiceName, TimestampTime, Timestamp)
TTL toDate(TimestampTime) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_logs
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_logs (see the app.traces note above).
ALTER TABLE app.logs
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_body Body TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8;

-- Codecs mirrored from otel.otel_logs (see the app.traces note above).
ALTER TABLE app.logs
  MODIFY COLUMN `Timestamp` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TimestampTime` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TraceId` String CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanId` String CODEC(ZSTD(1)),
  MODIFY COLUMN `SeverityText` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Body` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `EventName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id,
  dictGetOrDefault('app.tenant_retention', 'logs_days', ResourceAttributes['everr.tenant.id'], dictGet('app.tenant_retention', 'logs_days', '')) AS retention_days
FROM otel.otel_logs;

-- Metrics (Gauge): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_gauge
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDate(TimeUnix) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_metrics_gauge
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_metrics_gauge (see the app.traces note above).
ALTER TABLE app.metrics_gauge
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_gauge (see the app.traces note above).
ALTER TABLE app.metrics_gauge
  MODIFY COLUMN `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` String CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Value` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime64(9)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_gauge_mv
TO app.metrics_gauge
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id,
  dictGetOrDefault('app.tenant_retention', 'metrics_days', ResourceAttributes['everr.tenant.id'], dictGet('app.tenant_retention', 'metrics_days', '')) AS retention_days
FROM otel.otel_metrics_gauge;

-- Metrics (Sum): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_sum
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDate(TimeUnix) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_metrics_sum
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_metrics_sum (see the app.traces note above).
ALTER TABLE app.metrics_sum
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_sum (see the app.traces note above).
ALTER TABLE app.metrics_sum
  MODIFY COLUMN `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` String CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Value` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime64(9)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `AggregationTemporality` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `IsMonotonic` Bool CODEC(Delta(1), ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_sum_mv
TO app.metrics_sum
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id,
  dictGetOrDefault('app.tenant_retention', 'metrics_days', ResourceAttributes['everr.tenant.id'], dictGet('app.tenant_retention', 'metrics_days', '')) AS retention_days
FROM otel.otel_metrics_sum;

-- Metrics (Histogram): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_histogram
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDate(TimeUnix) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_metrics_histogram
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_metrics_histogram (see the app.traces note above).
ALTER TABLE app.metrics_histogram
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_histogram (see the app.traces note above).
ALTER TABLE app.metrics_histogram
  MODIFY COLUMN `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` String CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `BucketCounts` Array(UInt64) CODEC(ZSTD(1)),
  MODIFY COLUMN `ExplicitBounds` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime64(9)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `Min` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Max` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `AggregationTemporality` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_histogram_mv
TO app.metrics_histogram
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id,
  dictGetOrDefault('app.tenant_retention', 'metrics_days', ResourceAttributes['everr.tenant.id'], dictGet('app.tenant_retention', 'metrics_days', '')) AS retention_days
FROM otel.otel_metrics_histogram;

-- Metrics (Exponential Histogram): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_exponential_histogram
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDate(TimeUnix) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_metrics_exponential_histogram
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_metrics_exponential_histogram (see the app.traces note above).
ALTER TABLE app.metrics_exponential_histogram
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_exponential_histogram (see the app.traces note above).
ALTER TABLE app.metrics_exponential_histogram
  MODIFY COLUMN `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` String CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Scale` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `ZeroCount` UInt64 CODEC(ZSTD(1)),
  MODIFY COLUMN `PositiveOffset` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `PositiveBucketCounts` Array(UInt64) CODEC(ZSTD(1)),
  MODIFY COLUMN `NegativeOffset` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `NegativeBucketCounts` Array(UInt64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime64(9)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `Min` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Max` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `AggregationTemporality` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_exponential_histogram_mv
TO app.metrics_exponential_histogram
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id,
  dictGetOrDefault('app.tenant_retention', 'metrics_days', ResourceAttributes['everr.tenant.id'], dictGet('app.tenant_retention', 'metrics_days', '')) AS retention_days
FROM otel.otel_metrics_exponential_histogram;

-- Metrics (Summary): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_summary
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, Attributes, toUnixTimestamp64Nano(TimeUnix))
TTL toDate(TimeUnix) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_metrics_summary
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_metrics_summary (see the app.traces note above).
ALTER TABLE app.metrics_summary
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_key mapKeys(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_summary (see the app.traces note above).
ALTER TABLE app.metrics_summary
  MODIFY COLUMN `ResourceAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` String CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` LowCardinality(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` String CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` String CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` Map(LowCardinality(String), String) CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime64(9) CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `ValueAtQuantiles.Quantile` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `ValueAtQuantiles.Value` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_summary_mv
TO app.metrics_summary
AS
SELECT
  *,
  ResourceAttributes['everr.tenant.id'] AS tenant_id,
  dictGetOrDefault('app.tenant_retention', 'metrics_days', ResourceAttributes['everr.tenant.id'], dictGet('app.tenant_retention', 'metrics_days', '')) AS retention_days
FROM otel.otel_metrics_summary;
