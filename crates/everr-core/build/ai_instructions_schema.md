# Local telemetry schema

## otel_traces

| column | type |
|---|---|
| Timestamp | DateTime64(9) |
| TraceId | String |
| SpanId | String |
| ParentSpanId | String |
| TraceState | String |
| SpanName | LowCardinality(String) |
| SpanKind | LowCardinality(String) |
| ServiceName | LowCardinality(String) |
| ResourceAttributes | Map(LowCardinality(String), String) |
| ScopeName | String |
| ScopeVersion | String |
| SpanAttributes | Map(LowCardinality(String), String) |
| Duration | UInt64 |
| StatusCode | LowCardinality(String) |
| StatusMessage | String |
| Events.Timestamp | Array(DateTime64(9)) |
| Events.Name | Array(LowCardinality(String)) |
| Events.Attributes | Array(Map(LowCardinality(String), String)) |
| Links.TraceId | Array(String) |
| Links.SpanId | Array(String) |
| Links.TraceState | Array(String) |
| Links.Attributes | Array(Map(LowCardinality(String), String)) |

## otel_logs

| column | type |
|---|---|
| Timestamp | DateTime64(9) |
| TimestampTime | DateTime |
| TraceId | String |
| SpanId | String |
| TraceFlags | UInt8 |
| SeverityText | LowCardinality(String) |
| SeverityNumber | UInt8 |
| ServiceName | LowCardinality(String) |
| Body | String |
| ResourceSchemaUrl | LowCardinality(String) |
| ResourceAttributes | Map(LowCardinality(String), String) |
| ScopeSchemaUrl | LowCardinality(String) |
| ScopeName | String |
| ScopeVersion | LowCardinality(String) |
| ScopeAttributes | Map(LowCardinality(String), String) |
| LogAttributes | Map(LowCardinality(String), String) |
| EventName | String |

## otel_metrics_sum

| column | type |
|---|---|
| ResourceAttributes | Map(LowCardinality(String), String) |
| ResourceSchemaUrl | String |
| ScopeName | String |
| ScopeVersion | String |
| ScopeAttributes | Map(LowCardinality(String), String) |
| ScopeDroppedAttrCount | UInt32 |
| ScopeSchemaUrl | String |
| ServiceName | LowCardinality(String) |
| MetricName | String |
| MetricDescription | String |
| MetricUnit | String |
| Attributes | Map(LowCardinality(String), String) |
| StartTimeUnix | DateTime64(9) |
| TimeUnix | DateTime64(9) |
| Value | Float64 |
| Flags | UInt32 |
| Exemplars.FilteredAttributes | Array(Map(LowCardinality(String), String)) |
| Exemplars.TimeUnix | Array(DateTime64(9)) |
| Exemplars.Value | Array(Float64) |
| Exemplars.SpanId | Array(String) |
| Exemplars.TraceId | Array(String) |
| AggregationTemporality | Int32 |
| IsMonotonic | Bool |

## otel_metrics_gauge

| column | type |
|---|---|
| ResourceAttributes | Map(LowCardinality(String), String) |
| ResourceSchemaUrl | String |
| ScopeName | String |
| ScopeVersion | String |
| ScopeAttributes | Map(LowCardinality(String), String) |
| ScopeDroppedAttrCount | UInt32 |
| ScopeSchemaUrl | String |
| ServiceName | LowCardinality(String) |
| MetricName | String |
| MetricDescription | String |
| MetricUnit | String |
| Attributes | Map(LowCardinality(String), String) |
| StartTimeUnix | DateTime64(9) |
| TimeUnix | DateTime64(9) |
| Value | Float64 |
| Flags | UInt32 |
| Exemplars.FilteredAttributes | Array(Map(LowCardinality(String), String)) |
| Exemplars.TimeUnix | Array(DateTime64(9)) |
| Exemplars.Value | Array(Float64) |
| Exemplars.SpanId | Array(String) |
| Exemplars.TraceId | Array(String) |

## otel_metrics_histogram

| column | type |
|---|---|
| ResourceAttributes | Map(LowCardinality(String), String) |
| ResourceSchemaUrl | String |
| ScopeName | String |
| ScopeVersion | String |
| ScopeAttributes | Map(LowCardinality(String), String) |
| ScopeDroppedAttrCount | UInt32 |
| ScopeSchemaUrl | String |
| ServiceName | LowCardinality(String) |
| MetricName | String |
| MetricDescription | String |
| MetricUnit | String |
| Attributes | Map(LowCardinality(String), String) |
| StartTimeUnix | DateTime64(9) |
| TimeUnix | DateTime64(9) |
| Count | UInt64 |
| Sum | Float64 |
| BucketCounts | Array(UInt64) |
| ExplicitBounds | Array(Float64) |
| Exemplars.FilteredAttributes | Array(Map(LowCardinality(String), String)) |
| Exemplars.TimeUnix | Array(DateTime64(9)) |
| Exemplars.Value | Array(Float64) |
| Exemplars.SpanId | Array(String) |
| Exemplars.TraceId | Array(String) |
| Flags | UInt32 |
| Min | Float64 |
| Max | Float64 |
| AggregationTemporality | Int32 |

## otel_metrics_exponential_histogram

| column | type |
|---|---|
| ResourceAttributes | Map(LowCardinality(String), String) |
| ResourceSchemaUrl | String |
| ScopeName | String |
| ScopeVersion | String |
| ScopeAttributes | Map(LowCardinality(String), String) |
| ScopeDroppedAttrCount | UInt32 |
| ScopeSchemaUrl | String |
| ServiceName | LowCardinality(String) |
| MetricName | String |
| MetricDescription | String |
| MetricUnit | String |
| Attributes | Map(LowCardinality(String), String) |
| StartTimeUnix | DateTime64(9) |
| TimeUnix | DateTime64(9) |
| Count | UInt64 |
| Sum | Float64 |
| Scale | Int32 |
| ZeroCount | UInt64 |
| PositiveOffset | Int32 |
| PositiveBucketCounts | Array(UInt64) |
| NegativeOffset | Int32 |
| NegativeBucketCounts | Array(UInt64) |
| Exemplars.FilteredAttributes | Array(Map(LowCardinality(String), String)) |
| Exemplars.TimeUnix | Array(DateTime64(9)) |
| Exemplars.Value | Array(Float64) |
| Exemplars.SpanId | Array(String) |
| Exemplars.TraceId | Array(String) |
| Flags | UInt32 |
| Min | Float64 |
| Max | Float64 |
| AggregationTemporality | Int32 |

## otel_metrics_summary

| column | type |
|---|---|
| ResourceAttributes | Map(LowCardinality(String), String) |
| ResourceSchemaUrl | String |
| ScopeName | String |
| ScopeVersion | String |
| ScopeAttributes | Map(LowCardinality(String), String) |
| ScopeDroppedAttrCount | UInt32 |
| ScopeSchemaUrl | String |
| ServiceName | LowCardinality(String) |
| MetricName | String |
| MetricDescription | String |
| MetricUnit | String |
| Attributes | Map(LowCardinality(String), String) |
| StartTimeUnix | DateTime64(9) |
| TimeUnix | DateTime64(9) |
| Count | UInt64 |
| Sum | Float64 |
| ValueAtQuantiles.Quantile | Array(Float64) |
| ValueAtQuantiles.Value | Array(Float64) |
| Flags | UInt32 |

