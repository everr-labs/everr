-- Views stamp retention_days at ingestion. Daily partitions group rows by
-- expiry so ttl_only_drop_parts can expire them without rewrites. Plan changes
-- affect future rows; values come from packages/app/src/lib/retention.ts.
--
-- Metrics stamp retention before replacing ResourceAttributes, avoiding alias
-- shadowing. JSON columns strip retention through SKIP; their views filter the
-- keys array. everr.tenant.id remains in both attributes and keys.

-- Traces: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.traces
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
-- Put Timestamp directly after the tenant and service filters so time ranges
-- can prune without an equality filter on SpanName.
ORDER BY (tenant_id, ServiceName, Timestamp)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_traces
WHERE 1 = 0;

-- CREATE TABLE AS SELECT does not copy indexes. Attribute-key bloom filters
-- support presence checks; value reads use the JSON path subcolumns.
ALTER TABLE app.traces
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_keys ResourceAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_keys SpanAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_duration Duration TYPE minmax GRANULARITY 1;

-- CREATE TABLE AS SELECT also drops codecs. Restore them without repeating
-- column types, except JSON types whose SKIP rule belongs only to app tables.
-- Landing tables retain the retention path so views can read it.
ALTER TABLE app.traces
  MODIFY COLUMN `Timestamp` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `ParentSpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `TraceState` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanName` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanKind` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributes` JSON(max_dynamic_paths = 256, SKIP `everr.retention.days`) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `Duration` CODEC(ZSTD(1)),
  MODIFY COLUMN `StatusCode` CODEC(ZSTD(1)),
  MODIFY COLUMN `StatusMessage` CODEC(ZSTD(1)),
  MODIFY COLUMN `Events.Timestamp` CODEC(ZSTD(1)),
  MODIFY COLUMN `Events.Name` CODEC(ZSTD(1)),
  MODIFY COLUMN `Events.Attributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.TraceState` CODEC(ZSTD(1)),
  MODIFY COLUMN `Links.Attributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_mv
TO app.traces
AS
SELECT
  * EXCEPT (ResourceAttributesKeys),
  everrStripRetentionKeys(ResourceAttributesKeys) AS ResourceAttributesKeys
FROM
(
  SELECT
    *,
    toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
    everrRetentionDaysJson(ResourceAttributes) AS retention_days
  FROM otel.otel_traces
);

-- Each inserted batch contributes a trace window. Readers aggregate min(Start)
-- and max(End) + 1 before querying logs or traces; +1 covers whole-second truncation.
-- Monthly partitions and small granules reduce point-lookup reads. Whole-part
-- expiry can retain these lookup rows up to a month beyond their spans.
-- Measurements: docs/clickhouse-retention-rollout.md.
CREATE TABLE IF NOT EXISTS app.traces_trace_id_ts
(
  tenant_id String CODEC(ZSTD(1)),
  TraceId String CODEC(ZSTD(1)),
  Start DateTime CODEC(Delta(4), ZSTD(1)),
  End DateTime CODEC(Delta(4), ZSTD(1)),
  retention_days UInt16
)
ENGINE = MergeTree
PARTITION BY (toStartOfMonth(Start), retention_days)
ORDER BY (tenant_id, TraceId, Start)
TTL toDate(Start) + toIntervalDay(retention_days)
SETTINGS index_granularity = 256, ttl_only_drop_parts = 1;

-- Read the landing table directly: chaining off app.traces would require
-- the collector user to have SELECT access to app.*, beyond its otel.* grants.
CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_trace_id_ts_mv
TO app.traces_trace_id_ts
AS
SELECT
  toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
  TraceId,
  min(Timestamp) AS Start,
  max(Timestamp) AS End,
  everrRetentionDaysJson(ResourceAttributes) AS retention_days
FROM otel.otel_traces
WHERE TraceId != ''
GROUP BY tenant_id, retention_days, TraceId;

-- Logs: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.logs
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
-- Keep Timestamp directly after ServiceName so the explorer time predicate
-- prunes without an additional bucket predicate.
ORDER BY (tenant_id, ServiceName, Timestamp)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
  toUInt16(0) AS retention_days
FROM otel.otel_logs
WHERE 1 = 0;

-- Skip indexes mirrored from otel.otel_logs (see the app.traces note above).
--
-- idx_lower_body indexes lower(Body), not Body, because upstream does: an
-- index on the raw column cannot serve a case-insensitive lookup at all. No
-- index serves positionCaseInsensitive, which is what the logs explorer emits
-- today, so this one currently prunes nothing. It is upstream's shape so that
-- a move to hasToken(lower(Body), ...) can use it: measured on 500k rows with
-- one match, that predicate read 65,536 rows against a 500,000-row full scan.
--
-- It also stays tokenbf_v1 while upstream uses TYPE
-- text(tokenizer = 'splitByNonAlpha') on ClickHouse 26.2 and later. This is
-- the closer of the two calls. On 1M rows with one match, text() read 8,192
-- rows against 65,536 for hasToken, 8 times better, but cost 7.05 MiB against
-- 227.33 KiB on 17.45 MiB of data. We do not collect that 8 times today,
-- because the explorer emits positionCaseInsensitive and not hasToken.
-- Converting is a standalone DROP INDEX / ADD INDEX and is not gated on a
-- table rebuild, so make the trade if body search becomes a hot path.
ALTER TABLE app.logs
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_keys ResourceAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_keys ScopeAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_keys LogAttributesKeys TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_lower_body lower(Body) TYPE tokenbf_v1(32768, 3, 0) GRANULARITY 8;

-- Codecs mirrored from otel.otel_logs (see the app.traces note above).
ALTER TABLE app.logs
  MODIFY COLUMN `Timestamp` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SeverityText` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `Body` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributes` JSON(max_dynamic_paths = 256, SKIP `everr.retention.days`) CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributes` JSON(max_dynamic_paths = 256) CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributesKeys` CODEC(ZSTD(1)),
  MODIFY COLUMN `EventName` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
AS
SELECT
  * EXCEPT (ResourceAttributesKeys),
  everrStripRetentionKeys(ResourceAttributesKeys) AS ResourceAttributesKeys
FROM
(
  SELECT
    *,
    toString(getSubcolumn(ResourceAttributes, 'everr.tenant.id')) AS tenant_id,
    everrRetentionDaysJson(ResourceAttributes) AS retention_days
  FROM otel.otel_logs
);

-- Metrics group series within each hour. Hashing attributes keeps the primary
-- index compact while preserving series locality for compression.
-- Keep idx_time_minmax: the trailing TimeUnix key alone does not reliably prune
-- granules containing multiple hours or series.
-- Measurements: docs/clickhouse-retention-rollout.md.
CREATE TABLE IF NOT EXISTS app.metrics_gauge
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
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
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_gauge (see the app.traces note above).
ALTER TABLE app.metrics_gauge
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Value` CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_gauge_mv
TO app.metrics_gauge
AS
SELECT
  * EXCEPT (ResourceAttributes),
  everrStripRetention(ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    everrRetentionDays(ResourceAttributes) AS retention_days
  FROM otel.otel_metrics_gauge
);

-- Metrics (Sum): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_sum
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
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
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_sum (see the app.traces note above).
ALTER TABLE app.metrics_sum
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Value` CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `AggregationTemporality` CODEC(ZSTD(1)),
  MODIFY COLUMN `IsMonotonic` CODEC(Delta(1), ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_sum_mv
TO app.metrics_sum
AS
SELECT
  * EXCEPT (ResourceAttributes),
  everrStripRetention(ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    everrRetentionDays(ResourceAttributes) AS retention_days
  FROM otel.otel_metrics_sum
);

-- Metrics (Histogram): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_histogram
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
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
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_histogram (see the app.traces note above).
ALTER TABLE app.metrics_histogram
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Count` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` CODEC(ZSTD(1)),
  MODIFY COLUMN `BucketCounts` CODEC(ZSTD(1)),
  MODIFY COLUMN `ExplicitBounds` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` CODEC(ZSTD(1)),
  MODIFY COLUMN `Min` CODEC(ZSTD(1)),
  MODIFY COLUMN `Max` CODEC(ZSTD(1)),
  MODIFY COLUMN `AggregationTemporality` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_histogram_mv
TO app.metrics_histogram
AS
SELECT
  * EXCEPT (ResourceAttributes),
  everrStripRetention(ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    everrRetentionDays(ResourceAttributes) AS retention_days
  FROM otel.otel_metrics_histogram
);

-- Metrics (Exponential Histogram): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_exponential_histogram
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
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
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_exponential_histogram (see the app.traces note above).
ALTER TABLE app.metrics_exponential_histogram
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Count` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` CODEC(ZSTD(1)),
  MODIFY COLUMN `Scale` CODEC(ZSTD(1)),
  MODIFY COLUMN `ZeroCount` CODEC(ZSTD(1)),
  MODIFY COLUMN `PositiveOffset` CODEC(ZSTD(1)),
  MODIFY COLUMN `PositiveBucketCounts` CODEC(ZSTD(1)),
  MODIFY COLUMN `NegativeOffset` CODEC(ZSTD(1)),
  MODIFY COLUMN `NegativeBucketCounts` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` CODEC(ZSTD(1)),
  MODIFY COLUMN `Min` CODEC(ZSTD(1)),
  MODIFY COLUMN `Max` CODEC(ZSTD(1)),
  MODIFY COLUMN `AggregationTemporality` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_exponential_histogram_mv
TO app.metrics_exponential_histogram
AS
SELECT
  * EXCEPT (ResourceAttributes),
  everrStripRetention(ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    everrRetentionDays(ResourceAttributes) AS retention_days
  FROM otel.otel_metrics_exponential_histogram
);

-- Metrics (Summary): tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.metrics_summary
ENGINE = MergeTree
PARTITION BY (toDate(TimeUnix), retention_days)
ORDER BY (tenant_id, ServiceName, MetricName, toStartOfHour(TimeUnix), cityHash64(Attributes), TimeUnix)
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
  ADD INDEX IF NOT EXISTS idx_attr_value mapValues(Attributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_time_minmax TimeUnix TYPE minmax GRANULARITY 1;

-- Codecs mirrored from otel.otel_metrics_summary (see the app.traces note above).
ALTER TABLE app.metrics_summary
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeDroppedAttrCount` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricName` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricDescription` CODEC(ZSTD(1)),
  MODIFY COLUMN `MetricUnit` CODEC(ZSTD(1)),
  MODIFY COLUMN `Attributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `StartTimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Count` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` CODEC(ZSTD(1)),
  MODIFY COLUMN `ValueAtQuantiles.Quantile` CODEC(ZSTD(1)),
  MODIFY COLUMN `ValueAtQuantiles.Value` CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_summary_mv
TO app.metrics_summary
AS
SELECT
  * EXCEPT (ResourceAttributes),
  everrStripRetention(ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    everrRetentionDays(ResourceAttributes) AS retention_days
  FROM otel.otel_metrics_summary
);
