import { MCP_MAX_CELL_CHARS, MCP_MAX_ROWS } from "@/data/mcp/run-sql";

// A compressed everr-use-telemetry skill. MCP clients only see this text, so
// it carries the schema, units, enum spellings, and the recipes that save a
// round trip per wrong guess. Keep it in sync with
// crates/everr-core/assets/skills/everr-use-telemetry/SKILL.md.
export const QUERY_TOOL_DESCRIPTION = `Run one read-only ClickHouse SQL query (SELECT, WITH, DESCRIBE, SHOW, EXPLAIN) over your organization's OpenTelemetry data. A row policy already scopes rows to your organization.

Output: a "columns" line with name and type, then one JSON array per row. Only the first ${MCP_MAX_ROWS} rows are shown and strings are cut at ${MCP_MAX_CELL_CHARS} chars (read more with substring()). 64-bit integers come back as strings. Queries time out after 30s.

Tables (sort key is ServiceName, Timestamp: filter on both when you can)
- traces: Timestamp DateTime64(9), TraceId, SpanId, ParentSpanId, ServiceName, SpanName, SpanKind ('Server'|'Client'|'Internal'|'Producer'|'Consumer'), Duration UInt64 in NANOSECONDS (Duration / 1e6 = ms), StatusCode ('Unset'|'Ok'|'Error'), StatusMessage, SpanAttributes, ResourceAttributes, SpanAttributesKeys, ResourceAttributesKeys, Events.Name, Events.Timestamp, Events.Attributes.
- logs: Timestamp, TraceId, SpanId, ServiceName, SeverityText, SeverityNumber (>= 17 is ERROR or worse), Body, EventName, LogAttributes, ResourceAttributes, LogAttributesKeys, ResourceAttributesKeys.
- metrics_gauge, metrics_sum: TimeUnix, ServiceName, MetricName, MetricUnit, Attributes Map, Value. metrics_sum adds IsMonotonic, AggregationTemporality.
- metrics_histogram: TimeUnix, ServiceName, MetricName, MetricUnit, Attributes Map, Count, Sum, Min, Max, BucketCounts, ExplicitBounds. metrics_exponential_histogram and metrics_summary are similar; DESCRIBE them.
- traces_trace_id_ts: TraceId, Start, End (whole seconds). The time window of a trace.
- alert_events: alert history (event_time, event_type, is_live, ...). DESCRIBE it first and filter is_live.

Attributes
- SpanAttributes, LogAttributes, ResourceAttributes are JSON. Read a key as text with toString(SpanAttributes.\`http.route\`) (backticks around the dotted key; a missing key gives ''). Numbers: toFloat64OrZero(toString(...)). Never GROUP BY or compare the raw value: it is Dynamic and fails.
- Test presence with has(SpanAttributesKeys, 'http.route'); it is indexed.
- Metrics use maps: Attributes['key'].
- Key names vary by language and framework. Do not guess them; list them first:
  SELECT arrayJoin(SpanAttributesKeys) AS k, count() FROM traces WHERE Timestamp > now() - INTERVAL 1 HOUR AND ServiceName = 'api' GROUP BY k ORDER BY 2 DESC LIMIT 100

Rules
- Every diagnostic query needs a time window (Timestamp, or TimeUnix for metrics) and a LIMIT.
- Aggregate (count, quantile, GROUP BY) before you list rows.

Start here
- What is emitting, and how fresh:
  SELECT ServiceName, count() AS spans, max(Timestamp) AS last FROM traces WHERE Timestamp > now() - INTERVAL 1 DAY GROUP BY ServiceName ORDER BY spans DESC LIMIT 50
  (the same on logs; for metrics: SELECT ServiceName, MetricName, MetricUnit, max(TimeUnix) FROM metrics_sum WHERE TimeUnix > now() - INTERVAL 1 DAY GROUP BY ALL LIMIT 100)
- Span names of one service:
  SELECT SpanName, SpanKind, count() AS c, quantile(0.95)(Duration) / 1e6 AS p95_ms FROM traces WHERE Timestamp > now() - INTERVAL 1 HOUR AND ServiceName = 'api' GROUP BY SpanName, SpanKind ORDER BY c DESC LIMIT 50
- Recent errors:
  SELECT Timestamp, ServiceName, Body, toString(LogAttributes.\`exception.type\`) AS type, TraceId FROM logs WHERE Timestamp > now() - INTERVAL 1 HOUR AND SeverityNumber >= 17 ORDER BY Timestamp DESC LIMIT 50
- One trace by id. A bare TraceId filter scans everything, so take the window from traces_trace_id_ts first:
  WITH (SELECT min(Start) FROM traces_trace_id_ts WHERE TraceId = '<id>') AS s, (SELECT max(End) + 1 FROM traces_trace_id_ts WHERE TraceId = '<id>') AS e SELECT Timestamp, ServiceName, SpanName, SpanKind, Duration / 1e6 AS ms, StatusCode, SpanId, ParentSpanId FROM traces WHERE Timestamp BETWEEN s AND e AND TraceId = '<id>' ORDER BY Timestamp LIMIT 200
  (the same window works on logs for the trace's logs)
- Error groups: errorFingerprint(ServiceName, toString(LogAttributes.\`error.fingerprint\`), toString(LogAttributes.\`exception.type\`), toString(LogAttributes.\`exception.message\`)) returns the fingerprint Everr groups errors by.`;
