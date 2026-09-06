-- Per-row retention. Every app.* row is stamped with `retention_days` by its
-- materialized view from the resource attribute the collector sets at
-- authentication (everr.retention.days, one key holding the window for that
-- pipeline's signal), and the view strips it before storage. The table
-- partitions by (day, retention_days) and the TTL is `day + retention_days`
-- with ttl_only_drop_parts = 1. Every row in a partition expires on the same
-- day, so ClickHouse drops whole parts and never rewrites one to expire a
-- single tenant. A retention change applies to rows ingested from that point
-- on. Every distinct retention value costs that many live partitions per
-- table; RETENTION_BY_TIER (packages/app/src/lib/retention.ts) is the only
-- source of values.
--
-- Only the views write these tables. everrRetentionDays and
-- everrStripRetention (05-create-retention-functions.sql) hold the stamp and
-- the strip. The stamp is computed in an inner query because the
-- `everrStripRetention(...) AS ResourceAttributes` alias in the outer query
-- shadows the source column.

-- Traces: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.traces
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
-- Upstream sorts traces by (ServiceName, SpanName, toDateTime(Timestamp)).
-- Nothing here filters SpanName by equality (the explorer only substring
-- matches it) and every query carries a time window, so a span name ahead of
-- the time column made a 15-minute window read a whole day's part: measured
-- on 15M spans, 500,000 rows against 49,152 with the time column directly
-- after the service. Time order also keeps a trace's spans adjacent, which
-- took the table from 724 to 505 MiB (Timestamp 47 to 0.9 MiB, TraceId 232
-- to 93 MiB) and the by-id lookup from 8 granules to 3. The raw DateTime64
-- is the key column on purpose; the app.logs note below says why no bucket
-- goes in front of it.
ORDER BY (tenant_id, ServiceName, Timestamp)
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
--
-- The map indexes stay bloom_filter on purpose, here and in every app.* table
-- below. Upstream's exporter switches them to TYPE text(tokenizer = 'array')
-- on ClickHouse 26.2 and later, so a diff against upstream shows a difference.
-- Do not "fix" it. Measured on 1M rows with one match, both types read the
-- same 8,192 rows for the two predicates the app emits, mapContains(map, key)
-- and map[key] IN (...), but the text indexes cost 5.94 MiB against 11.71 KiB
-- for bloom_filter on 7.81 MiB of data. That is 500 times the index storage
-- for identical pruning, paid on every partition for the full retention
-- window. Revisit only if we add substring or token search inside attribute
-- values, which bloom_filter cannot serve and text() can.
ALTER TABLE app.traces
  ADD INDEX IF NOT EXISTS idx_trace_id TraceId TYPE bloom_filter(0.001) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_key mapKeys(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_span_attr_value mapValues(SpanAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_duration Duration TYPE minmax GRANULARITY 1;

-- Codecs for app.traces. CREATE TABLE ... AS SELECT copies types but not
-- codecs, so without this every column falls back to LZ4 and the table is
-- about twice the size of the raw copy. MODIFY COLUMN without a type keeps
-- the type the CTAS copied, so 03-create-otel-tables.sql stays the only place
-- a column type is written. Every app.* table below repeats this for its own
-- source.
ALTER TABLE app.traces
  MODIFY COLUMN `Timestamp` CODEC(Delta(8), ZSTD(1)),
  MODIFY COLUMN `TraceId` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `ParentSpanId` CODEC(ZSTD(1)),
  MODIFY COLUMN `TraceState` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanName` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanKind` CODEC(ZSTD(1)),
  MODIFY COLUMN `ServiceName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `SpanAttributes` CODEC(ZSTD(1)),
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
  * EXCEPT (ResourceAttributes),
  everrStripRetention(ResourceAttributes) AS ResourceAttributes
FROM
(
  SELECT
    *,
    ResourceAttributes['everr.tenant.id'] AS tenant_id,
    everrRetentionDays(ResourceAttributes) AS retention_days
  FROM otel.otel_traces
);

-- Trace id to time range. app.traces sorts by service and time, so a lookup
-- by TraceId alone has no key prefix to use and reads the TraceId bloom
-- filter of every part in the table. This table sorts by the id: a reader
-- takes min(Start) and max(End) + 1 for one TraceId here, then reads
-- app.traces or app.logs with that window, and both prune parts. The view
-- fires once per inserted block, so a trace whose spans arrive in several
-- batches has several rows, which is why readers aggregate. Start and End are
-- whole seconds; the + 1 covers the truncation of End. Same shape as the
-- local store's traces_trace_id_ts, so one query serves both. The explorer
-- and the run views do not use it, they already know their window. No skip
-- index on TraceId: the key starts with it.
CREATE TABLE IF NOT EXISTS app.traces_trace_id_ts
(
  tenant_id String CODEC(ZSTD(1)),
  TraceId String CODEC(ZSTD(1)),
  Start DateTime CODEC(Delta(4), ZSTD(1)),
  End DateTime CODEC(Delta(4), ZSTD(1)),
  retention_days UInt16
)
ENGINE = MergeTree
PARTITION BY (toDate(Start), retention_days)
ORDER BY (tenant_id, TraceId, Start)
TTL toDate(Start) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1;

-- Chained off app.traces rather than otel.otel_traces so tenant_id and
-- retention_days come from the row app.traces_mv already stamped.
CREATE MATERIALIZED VIEW IF NOT EXISTS app.traces_trace_id_ts_mv
TO app.traces_trace_id_ts
AS
SELECT
  tenant_id,
  TraceId,
  min(Timestamp) AS Start,
  max(Timestamp) AS End,
  retention_days
FROM app.traces
WHERE TraceId != ''
GROUP BY tenant_id, retention_days, TraceId;

-- Logs: tenant-enriched read table + MV
CREATE TABLE IF NOT EXISTS app.logs
ENGINE = MergeTree
PARTITION BY (toDate(Timestamp), retention_days)
-- The raw Timestamp sits directly after ServiceName. Do not put a bucket
-- such as toStartOfFiveMinutes(Timestamp) in front of it, which is what
-- upstream's (ServiceName, TimestampTime) key becomes once TimestampTime is
-- gone. ClickHouse binds a `Timestamp >= x` predicate to the key column that
-- is Timestamp, never to a function of it that sits earlier, and it can only
-- exclude a granule on that column when every earlier column is constant
-- inside the granule. Below about 8192 rows per service per bucket the
-- bucket changes inside every granule and nothing is excluded: measured on
-- this table at 694 rows per five-minute bucket, a 15-minute window read 25
-- of 25 granules, and 2 of 25 once the bucket predicate was added to the
-- query by hand. The flat key prunes with the query as the explorer emits it
-- (6 of 1,840 granules on a 15M-row part) and orders the rows exactly as the
-- bucketed key would, so it costs nothing in compression. Range pruning on a
-- sorted DateTime64 does not need runs of equal values.
ORDER BY (tenant_id, ServiceName, Timestamp)
TTL toDate(Timestamp) + toIntervalDay(retention_days)
SETTINGS index_granularity = 8192, ttl_only_drop_parts = 1
AS
SELECT
  *,
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
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
  ADD INDEX IF NOT EXISTS idx_res_attr_key mapKeys(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_res_attr_value mapValues(ResourceAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_key mapKeys(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_scope_attr_value mapValues(ScopeAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_key mapKeys(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
  ADD INDEX IF NOT EXISTS idx_log_attr_value mapValues(LogAttributes) TYPE bloom_filter(0.01) GRANULARITY 1,
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
  MODIFY COLUMN `ResourceAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeSchemaUrl` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeName` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeVersion` CODEC(ZSTD(1)),
  MODIFY COLUMN `ScopeAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `LogAttributes` CODEC(ZSTD(1)),
  MODIFY COLUMN `EventName` CODEC(ZSTD(1)),
  MODIFY COLUMN `tenant_id` CODEC(ZSTD(1));

CREATE MATERIALIZED VIEW IF NOT EXISTS app.logs_mv
TO app.logs
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
--
-- idx_time_minmax below does the time pruning, not the primary key. A
-- `TimeUnix >= x` predicate binds to the trailing TimeUnix column, and a
-- granule is only excluded on it when the hour and the hash are constant
-- across the granule, which at a few thousand rows per hour they never are:
-- measured on this table at 4,800 rows per hour, the primary key read 15 of
-- 15 granules for a 15-minute window and the minmax index took it to 2 of
-- 15. The index is load-bearing, not a mirrored decoration.
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
