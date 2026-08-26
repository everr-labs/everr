// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0

package sqltemplates

import "fmt"

// Keep these expressions in step with the matching RowBytes expressions in
// clickhouse/init/13-create-usage-metering.sql. They intentionally cover the
// cloud schema's source columns and exclude local-only materialized helpers.
const (
	TracesRowBytesExpression = `byteSize(
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
    ` + "`Events.Timestamp`" + `,
    ` + "`Events.Name`" + `,
    ` + "`Events.Attributes`" + `,
    ` + "`Links.TraceId`" + `,
    ` + "`Links.SpanId`" + `,
    ` + "`Links.TraceState`" + `,
    ` + "`Links.Attributes`" + `
)`

	LogsRowBytesExpression = `byteSize(
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
)`

	MetricsGaugeRowBytesExpression = `byteSize(
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
    ` + "`Exemplars.FilteredAttributes`" + `,
    ` + "`Exemplars.TimeUnix`" + `,
    ` + "`Exemplars.Value`" + `,
    ` + "`Exemplars.SpanId`" + `,
    ` + "`Exemplars.TraceId`" + `
)`

	MetricsSumRowBytesExpression = `byteSize(
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
    ` + "`Exemplars.FilteredAttributes`" + `,
    ` + "`Exemplars.TimeUnix`" + `,
    ` + "`Exemplars.Value`" + `,
    ` + "`Exemplars.SpanId`" + `,
    ` + "`Exemplars.TraceId`" + `,
    AggregationTemporality,
    IsMonotonic
)`

	MetricsHistogramRowBytesExpression = `byteSize(
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
    ` + "`Exemplars.FilteredAttributes`" + `,
    ` + "`Exemplars.TimeUnix`" + `,
    ` + "`Exemplars.Value`" + `,
    ` + "`Exemplars.SpanId`" + `,
    ` + "`Exemplars.TraceId`" + `,
    Flags,
    Min,
    Max,
    AggregationTemporality
)`

	MetricsExpHistogramRowBytesExpression = `byteSize(
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
    ` + "`Exemplars.FilteredAttributes`" + `,
    ` + "`Exemplars.TimeUnix`" + `,
    ` + "`Exemplars.Value`" + `,
    ` + "`Exemplars.SpanId`" + `,
    ` + "`Exemplars.TraceId`" + `,
    Flags,
    Min,
    Max,
    AggregationTemporality
)`

	MetricsSummaryRowBytesExpression = `byteSize(
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
    ` + "`ValueAtQuantiles.Quantile`" + `,
    ` + "`ValueAtQuantiles.Value`" + `,
    Flags
)`
)

// AddRowBytesColumnSQL returns the idempotent migration used for local tables
// created before RowBytes became part of the schema.
func AddRowBytesColumnSQL(database, table, cluster, expression string) string {
	if cluster != "" {
		cluster = " " + cluster
	}
	return fmt.Sprintf(
		"ALTER TABLE %q.%q%s ADD COLUMN IF NOT EXISTS `RowBytes` UInt64 MATERIALIZED %s",
		database,
		table,
		cluster,
		expression,
	)
}
