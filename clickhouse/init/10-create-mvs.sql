-- Per-row retention. Every app.* row is stamped with `retention_days` by its
-- materialized view from the resource attribute the collector sets at
-- authentication (everr.retention.days, one key holding the window for that
-- pipeline's signal), and the view strips it before storage. The table partitions by (day, retention_days) and the
-- TTL is `day + retention_days` with ttl_only_drop_parts = 1. Every row in a
-- partition expires on the same day, so ClickHouse drops whole parts and never
-- rewrites one to expire a single tenant. A retention change applies to rows
-- ingested from that point on. Every distinct retention value costs that many
-- live partitions per table; RETENTION_BY_TIER (packages/app/src/lib/retention.ts)
-- is the only source of values.
--
-- Only the views write these tables. A missing retention attribute would
-- stamp 0 and expire the row at insert with no error, so the views refuse
-- the row instead: `toUInt16OrZero(x) + throwIf(x = '', ...)`. Do not write
-- it as if(x = '', throwIf(true, ...), ...): the constant throwIf is folded
-- and fires on every row. The stamps are computed in an inner query because
-- the `mapFilter(...) AS ResourceAttributes` alias in the outer query shadows
-- the source column.

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
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k != 'everr.retention.days', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.days'])
      + throwIf(ResourceAttributes['everr.retention.days'] = '', 'everr.retention.days resource attribute missing') AS retention_days
  FROM otel.otel_traces
);

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
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k != 'everr.retention.days', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.days'])
      + throwIf(ResourceAttributes['everr.retention.days'] = '', 'everr.retention.days resource attribute missing') AS retention_days
  FROM otel.otel_logs
);

-- Metrics (Gauge): tenant-enriched read table + MV
--
-- The five metrics tables order by the hour before the attributes, which is
-- what the upstream exporter does since v0.160.0. Dashboard panels all filter
-- ServiceName + MetricName + a time range and aggregate across series, and
-- with the attributes ahead of the time column every granule of a metric held
-- points from the whole day, so a time filter pruned nothing and a 15-minute
-- panel read the same rows as a 24-hour one.
--
-- cityHash64(Attributes) groups without ordering: rows of one series share a
-- hash so they stay adjacent inside the hour and the Attributes column still
-- compresses by run, but the primary index (held in memory) stores 8 bytes per
-- granule instead of a whole map. Dropping the attributes from the key instead
-- nearly doubles that column. The cost is that an attribute predicate can no
-- longer prune granules, which only matters when reading one high-cardinality
-- series over a long range; no built-in dashboard does that.
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
  MODIFY COLUMN `StartTimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Value` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.Value` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.SpanId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TraceId` Array(String) CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` String CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.metrics_gauge_mv
TO app.metrics_gauge
AS
SELECT
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k != 'everr.retention.days', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.days'])
      + throwIf(ResourceAttributes['everr.retention.days'] = '', 'everr.retention.days resource attribute missing') AS retention_days
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
  MODIFY COLUMN `StartTimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Value` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Flags` UInt32 CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime) CODEC(ZSTD(1)),
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
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k != 'everr.retention.days', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.days'])
      + throwIf(ResourceAttributes['everr.retention.days'] = '', 'everr.retention.days resource attribute missing') AS retention_days
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
  MODIFY COLUMN `StartTimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `BucketCounts` Array(UInt64) CODEC(ZSTD(1)),
  MODIFY COLUMN `ExplicitBounds` Array(Float64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime) CODEC(ZSTD(1)),
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
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k != 'everr.retention.days', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.days'])
      + throwIf(ResourceAttributes['everr.retention.days'] = '', 'everr.retention.days resource attribute missing') AS retention_days
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
  MODIFY COLUMN `StartTimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `Count` UInt64 CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `Sum` Float64 CODEC(ZSTD(1)),
  MODIFY COLUMN `Scale` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `ZeroCount` UInt64 CODEC(ZSTD(1)),
  MODIFY COLUMN `PositiveOffset` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `PositiveBucketCounts` Array(UInt64) CODEC(ZSTD(1)),
  MODIFY COLUMN `NegativeOffset` Int32 CODEC(ZSTD(1)),
  MODIFY COLUMN `NegativeBucketCounts` Array(UInt64) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.FilteredAttributes` Array(Map(LowCardinality(String), String)) CODEC(ZSTD(1)),
  MODIFY COLUMN `Exemplars.TimeUnix` Array(DateTime) CODEC(ZSTD(1)),
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
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k != 'everr.retention.days', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.days'])
      + throwIf(ResourceAttributes['everr.retention.days'] = '', 'everr.retention.days resource attribute missing') AS retention_days
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
  MODIFY COLUMN `StartTimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
  MODIFY COLUMN `TimeUnix` DateTime CODEC(Delta(4), ZSTD(1)),
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
  * EXCEPT (ResourceAttributes),
  mapFilter((k, v) -> k != 'everr.retention.days', ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    toUInt16OrZero(ResourceAttributes['everr.retention.days'])
      + throwIf(ResourceAttributes['everr.retention.days'] = '', 'everr.retention.days resource attribute missing') AS retention_days
  FROM otel.otel_metrics_summary
);
