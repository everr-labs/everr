-- Landing tables for the collector's ClickHouse exporter. ENGINE = Null
-- stores nothing: an insert only triggers the materialized views in
-- 10-create-mvs.sql, which stamp tenant_id and retention_days from the
-- resource attributes and write the row into app.*. Column lists follow the
-- upstream clickhouseexporter schema for the version pinned in
-- collector/config/manifest.yaml (v0.160.0); app.* copies its types from here,
-- so keep them in step when that pin moves. The exporter's DDL is the
-- reference: internal/sqltemplates/*.sql in that module.
--
-- Types only, no codecs. A Null table compresses nothing, and app.* is built
-- with CREATE TABLE ... AS SELECT, which copies types but not codecs, so the
-- codecs that matter are the MODIFY COLUMN blocks in 10-create-mvs.sql.
-- Declaring them here as well only gave the two files something to drift on.

CREATE TABLE IF NOT EXISTS otel.otel_traces (
    Timestamp DateTime64(9),
    TraceId String,
    SpanId String,
    ParentSpanId String,
    TraceState String,
    SpanName LowCardinality(String),
    SpanKind LowCardinality(String),
    ServiceName LowCardinality(String),
    ResourceAttributes Map(LowCardinality(String), String),
    ScopeName String,
    ScopeVersion String,
    SpanAttributes Map(LowCardinality(String), String),
    Duration UInt64,
    StatusCode LowCardinality(String),
    StatusMessage String,
    Events Nested (
        Timestamp DateTime64(9),
        Name LowCardinality(String),
        Attributes Map(LowCardinality(String), String)
    ),
    Links Nested (
        TraceId String,
        SpanId String,
        TraceState String,
        Attributes Map(LowCardinality(String), String)
    )
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS otel.otel_logs (
    Timestamp DateTime64(9),
    TraceId String,
    SpanId String,
    TraceFlags UInt8,
    SeverityText LowCardinality(String),
    SeverityNumber UInt8,
    ServiceName LowCardinality(String),
    Body String,
    ResourceSchemaUrl LowCardinality(String),
    ResourceAttributes Map(LowCardinality(String), String),
    ScopeSchemaUrl LowCardinality(String),
    ScopeName String,
    ScopeVersion LowCardinality(String),
    ScopeAttributes Map(LowCardinality(String), String),
    LogAttributes Map(LowCardinality(String), String),
    EventName String
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_gauge (
    ResourceAttributes Map(LowCardinality(String), String),
    ResourceSchemaUrl String,
    ScopeName String,
    ScopeVersion String,
    ScopeAttributes Map(LowCardinality(String), String),
    ScopeDroppedAttrCount UInt32,
    ScopeSchemaUrl String,
    ServiceName LowCardinality(String),
    MetricName LowCardinality(String),
    MetricDescription String,
    MetricUnit String,
    Attributes Map(LowCardinality(String), String),
    StartTimeUnix DateTime,
    TimeUnix DateTime,
    Value Float64,
    Flags UInt32,
    Exemplars Nested (
        FilteredAttributes Map(LowCardinality(String), String),
        TimeUnix DateTime,
        Value Float64,
        SpanId String,
        TraceId String
    )
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_sum (
    ResourceAttributes Map(LowCardinality(String), String),
    ResourceSchemaUrl String,
    ScopeName String,
    ScopeVersion String,
    ScopeAttributes Map(LowCardinality(String), String),
    ScopeDroppedAttrCount UInt32,
    ScopeSchemaUrl String,
    ServiceName LowCardinality(String),
    MetricName LowCardinality(String),
    MetricDescription String,
    MetricUnit String,
    Attributes Map(LowCardinality(String), String),
    StartTimeUnix DateTime,
    TimeUnix DateTime,
    Value Float64,
    Flags UInt32,
    Exemplars Nested (
        FilteredAttributes Map(LowCardinality(String), String),
        TimeUnix DateTime,
        Value Float64,
        SpanId String,
        TraceId String
    ),
    AggregationTemporality Int32,
    IsMonotonic Boolean
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_histogram (
    ResourceAttributes Map(LowCardinality(String), String),
    ResourceSchemaUrl String,
    ScopeName String,
    ScopeVersion String,
    ScopeAttributes Map(LowCardinality(String), String),
    ScopeDroppedAttrCount UInt32,
    ScopeSchemaUrl String,
    ServiceName LowCardinality(String),
    MetricName LowCardinality(String),
    MetricDescription String,
    MetricUnit String,
    Attributes Map(LowCardinality(String), String),
    StartTimeUnix DateTime,
    TimeUnix DateTime,
    Count UInt64,
    Sum Float64,
    BucketCounts Array(UInt64),
    ExplicitBounds Array(Float64),
    Exemplars Nested (
        FilteredAttributes Map(LowCardinality(String), String),
        TimeUnix DateTime,
        Value Float64,
        SpanId String,
        TraceId String
    ),
    Flags UInt32,
    Min Float64,
    Max Float64,
    AggregationTemporality Int32
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_exponential_histogram (
    ResourceAttributes Map(LowCardinality(String), String),
    ResourceSchemaUrl String,
    ScopeName String,
    ScopeVersion String,
    ScopeAttributes Map(LowCardinality(String), String),
    ScopeDroppedAttrCount UInt32,
    ScopeSchemaUrl String,
    ServiceName LowCardinality(String),
    MetricName LowCardinality(String),
    MetricDescription String,
    MetricUnit String,
    Attributes Map(LowCardinality(String), String),
    StartTimeUnix DateTime,
    TimeUnix DateTime,
    Count UInt64,
    Sum Float64,
    Scale Int32,
    ZeroCount UInt64,
    PositiveOffset Int32,
    PositiveBucketCounts Array(UInt64),
    NegativeOffset Int32,
    NegativeBucketCounts Array(UInt64),
    Exemplars Nested (
        FilteredAttributes Map(LowCardinality(String), String),
        TimeUnix DateTime,
        Value Float64,
        SpanId String,
        TraceId String
    ),
    Flags UInt32,
    Min Float64,
    Max Float64,
    AggregationTemporality Int32
) ENGINE = Null;

CREATE TABLE IF NOT EXISTS otel.otel_metrics_summary (
    ResourceAttributes Map(LowCardinality(String), String),
    ResourceSchemaUrl String,
    ScopeName String,
    ScopeVersion String,
    ScopeAttributes Map(LowCardinality(String), String),
    ScopeDroppedAttrCount UInt32,
    ScopeSchemaUrl String,
    ServiceName LowCardinality(String),
    MetricName LowCardinality(String),
    MetricDescription String,
    MetricUnit String,
    Attributes Map(LowCardinality(String), String),
    StartTimeUnix DateTime,
    TimeUnix DateTime,
    Count UInt64,
    Sum Float64,
    ValueAtQuantiles Nested (
        Quantile Float64,
        Value Float64
    ),
    Flags UInt32
) ENGINE = Null;
