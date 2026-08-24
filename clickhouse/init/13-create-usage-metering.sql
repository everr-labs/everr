-- Per-tenant ingest metering. RowBytes is the canonical billable-size contract
-- for each raw landing table. Incremental materialized views aggregate new rows
-- into an hourly SummingMergeTree ledger using ClickHouse arrival time in UTC.

ALTER TABLE otel.otel_traces
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    Timestamp,
    TraceId,
    SpanId,
    ParentSpanId,
    TraceState,
    SpanName,
    SpanKind,
    ServiceName,
    ResourceAttributes,
    ScopeName,
    ScopeVersion,
    SpanAttributes,
    Duration,
    StatusCode,
    StatusMessage,
    `Events.Timestamp`,
    `Events.Name`,
    `Events.Attributes`,
    `Links.TraceId`,
    `Links.SpanId`,
    `Links.TraceState`,
    `Links.Attributes`
  );

-- ADD handles a pre-feature table. MODIFY makes a repeat apply converge an
-- existing definition after the landing schema changes. It changes metadata
-- for subsequent inserts and intentionally does not rewrite historical parts.
ALTER TABLE otel.otel_traces
  MODIFY COLUMN RowBytes UInt64 MATERIALIZED byteSize(
    Timestamp,
    TraceId,
    SpanId,
    ParentSpanId,
    TraceState,
    SpanName,
    SpanKind,
    ServiceName,
    ResourceAttributes,
    ScopeName,
    ScopeVersion,
    SpanAttributes,
    Duration,
    StatusCode,
    StatusMessage,
    `Events.Timestamp`,
    `Events.Name`,
    `Events.Attributes`,
    `Links.TraceId`,
    `Links.SpanId`,
    `Links.TraceState`,
    `Links.Attributes`
  );

ALTER TABLE otel.otel_logs
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    Timestamp,
    TimestampTime,
    TraceId,
    SpanId,
    TraceFlags,
    SeverityText,
    SeverityNumber,
    ServiceName,
    Body,
    ResourceSchemaUrl,
    ResourceAttributes,
    ScopeSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    LogAttributes,
    EventName
  );

ALTER TABLE otel.otel_logs
  MODIFY COLUMN RowBytes UInt64 MATERIALIZED byteSize(
    Timestamp,
    TimestampTime,
    TraceId,
    SpanId,
    TraceFlags,
    SeverityText,
    SeverityNumber,
    ServiceName,
    Body,
    ResourceSchemaUrl,
    ResourceAttributes,
    ScopeSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    LogAttributes,
    EventName
  );

ALTER TABLE otel.otel_metrics_gauge
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Value,
    Flags,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`
  );

ALTER TABLE otel.otel_metrics_gauge
  MODIFY COLUMN RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Value,
    Flags,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`
  );

ALTER TABLE otel.otel_metrics_sum
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Value,
    Flags,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`,
    AggregationTemporality,
    IsMonotonic
  );

ALTER TABLE otel.otel_metrics_sum
  MODIFY COLUMN RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Value,
    Flags,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`,
    AggregationTemporality,
    IsMonotonic
  );

ALTER TABLE otel.otel_metrics_histogram
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Count,
    Sum,
    BucketCounts,
    ExplicitBounds,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`,
    Flags,
    Min,
    Max,
    AggregationTemporality
  );

ALTER TABLE otel.otel_metrics_histogram
  MODIFY COLUMN RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Count,
    Sum,
    BucketCounts,
    ExplicitBounds,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`,
    Flags,
    Min,
    Max,
    AggregationTemporality
  );

ALTER TABLE otel.otel_metrics_exponential_histogram
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Count,
    Sum,
    Scale,
    ZeroCount,
    PositiveOffset,
    PositiveBucketCounts,
    NegativeOffset,
    NegativeBucketCounts,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`,
    Flags,
    Min,
    Max,
    AggregationTemporality
  );

ALTER TABLE otel.otel_metrics_exponential_histogram
  MODIFY COLUMN RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Count,
    Sum,
    Scale,
    ZeroCount,
    PositiveOffset,
    PositiveBucketCounts,
    NegativeOffset,
    NegativeBucketCounts,
    `Exemplars.FilteredAttributes`,
    `Exemplars.TimeUnix`,
    `Exemplars.Value`,
    `Exemplars.SpanId`,
    `Exemplars.TraceId`,
    Flags,
    Min,
    Max,
    AggregationTemporality
  );

ALTER TABLE otel.otel_metrics_summary
  ADD COLUMN IF NOT EXISTS RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Count,
    Sum,
    `ValueAtQuantiles.Quantile`,
    `ValueAtQuantiles.Value`,
    Flags
  );

ALTER TABLE otel.otel_metrics_summary
  MODIFY COLUMN RowBytes UInt64 MATERIALIZED byteSize(
    ResourceAttributes,
    ResourceSchemaUrl,
    ScopeName,
    ScopeVersion,
    ScopeAttributes,
    ScopeDroppedAttrCount,
    ScopeSchemaUrl,
    ServiceName,
    MetricName,
    MetricDescription,
    MetricUnit,
    Attributes,
    StartTimeUnix,
    TimeUnix,
    Count,
    Sum,
    `ValueAtQuantiles.Quantile`,
    `ValueAtQuantiles.Value`,
    Flags
  );

CREATE TABLE IF NOT EXISTS app.tenant_usage
(
  tenant_id String,
  meter LowCardinality(String),
  bucket DateTime('UTC'),
  bytes UInt64,
  items UInt64
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(bucket)
ORDER BY (tenant_id, bucket, meter);

GRANT SELECT ON app.tenant_usage TO app_ro;
GRANT INSERT, SELECT ON app.tenant_usage TO web_app_admin;

CREATE ROW POLICY OR REPLACE tenant_filter_tenant_usage
ON app.tenant_usage
FOR SELECT
USING tenant_id = getSetting('SQL_everr_tenant_id')
TO app_ro;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_traces_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'traces' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_traces
GROUP BY tenant_id, meter, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_logs_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'logs' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_logs
GROUP BY tenant_id, meter, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_metrics_gauge_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'metrics' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_metrics_gauge
GROUP BY tenant_id, meter, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_metrics_sum_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'metrics' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_metrics_sum
GROUP BY tenant_id, meter, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_metrics_histogram_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'metrics' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_metrics_histogram
GROUP BY tenant_id, meter, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_metrics_exponential_histogram_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'metrics' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_metrics_exponential_histogram
GROUP BY tenant_id, meter, bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS app.tenant_usage_metrics_summary_mv
TO app.tenant_usage
AS
SELECT
  CAST(ResourceAttributes['everr.tenant.id'] AS String) AS tenant_id,
  'metrics' AS meter,
  toStartOfHour(now('UTC')) AS bucket,
  sum(RowBytes) AS bytes,
  count() AS items
FROM otel.otel_metrics_summary
GROUP BY tenant_id, meter, bucket;
