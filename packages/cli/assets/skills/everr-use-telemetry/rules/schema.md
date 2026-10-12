# Telemetry Schema

The tables, columns, units, and value spellings of Everr telemetry, plus the queries to start from.

## Tables

The sort key of `traces` and `logs` is `ServiceName, Timestamp`. Filter on both when you can.

- `traces`: `Timestamp` DateTime64(9), `TraceId`, `SpanId`, `ParentSpanId`, `ServiceName`, `ScopeName`, `SpanName`, `SpanKind`, `Duration`, `StatusCode`, `StatusMessage`, `SpanAttributes`, `ResourceAttributes`, `SpanAttributesKeys`, `ResourceAttributesKeys`, `Events.Name`, `Events.Timestamp`, `Events.Attributes`.
- `logs`: `Timestamp`, `TraceId`, `SpanId`, `ServiceName`, `ScopeName`, `SeverityText`, `SeverityNumber`, `Body`, `EventName`, `LogAttributes`, `ResourceAttributes`, `LogAttributesKeys`, `ResourceAttributesKeys`.
- `metrics_gauge`, `metrics_sum`: `TimeUnix`, `ServiceName`, `MetricName`, `MetricUnit`, `Attributes`, `Value`. `metrics_sum` adds `IsMonotonic` and `AggregationTemporality`.
- `metrics_histogram`: `TimeUnix`, `ServiceName`, `MetricName`, `MetricUnit`, `Attributes`, `Count`, `Sum`, `Min`, `Max`, `BucketCounts`, `ExplicitBounds`. `metrics_exponential_histogram` and `metrics_summary` are similar: run `DESCRIBE TABLE` on them.
- `traces_trace_id_ts`: `TraceId`, `Start`, `End`. The time window of each trace in whole seconds, one row per trace per ingested batch. Aggregate with `min(Start)` and `max(End)`.
- `alert_events`: alert history, cloud only. One row per evaluation, state transition, withheld notification, or delivery attempt, told apart by `event_type`. Run `DESCRIBE TABLE alert_events` before you query it, bound `event_time`, and filter `is_live` (preview alerts write to the same table).

## Units And Values

- `Duration` is nanoseconds (`UInt64`): divide by `1e6` for milliseconds, `1e9` for seconds.
- `SpanKind` is one of `'Server'`, `'Client'`, `'Internal'`, `'Producer'`, `'Consumer'`.
- `StatusCode` is one of `'Unset'`, `'Ok'`, `'Error'`.
- `SeverityNumber >= 17` is ERROR or worse. `SeverityText` spelling varies by SDK, so filter on the number.
- Metrics carry their unit in `MetricUnit` (for example `s`, `ms`, `By`).

## Attributes

- `SpanAttributes`, `LogAttributes`, and `ResourceAttributes` are JSON columns. Read a key as text with `` toString(SpanAttributes.`http.route`) ``: backticks around the key, dots included. A missing key gives `''`.
- Read a number with `` toFloat64OrZero(toString(SpanAttributes.`key`)) ``.
- Never `GROUP BY` or compare the raw `` SpanAttributes.`key` ``: it is a `Dynamic` value, and the query fails.
- Test presence with `has(SpanAttributesKeys, 'key')`. It is indexed.
- The `metrics_*` tables keep maps: `Attributes['key']`.
- Attribute names vary across languages and frameworks. Do not guess them. List them first:

```sql
SELECT arrayJoin(SpanAttributesKeys) AS key, count() AS c
FROM traces
WHERE Timestamp > now() - INTERVAL 1 HOUR AND ServiceName = '<service>'
GROUP BY key
ORDER BY c DESC
LIMIT 100
```

## Query Rules

- Every diagnostic query needs a time window (`Timestamp`, or `TimeUnix` for metrics) and a `LIMIT`. `DESCRIBE` and freshness checks may omit the window.
- Aggregate (`count()`, `quantile`, `GROUP BY`) before you list rows.
- **Trace by id**: `traces` and `logs` are not sorted by `TraceId`, so a bare `TraceId = '...'` reads every part. Take the window from `traces_trace_id_ts` first, as in "One trace" below.

## Starter Queries

What is emitting, and how fresh it is (the same works on `logs`):
```sql
SELECT ServiceName, count() AS spans, max(Timestamp) AS last
FROM traces
WHERE Timestamp > now() - INTERVAL 1 DAY
GROUP BY ServiceName
ORDER BY spans DESC
LIMIT 50
```

What metrics exist:
```sql
SELECT ServiceName, MetricName, MetricUnit, max(TimeUnix) AS last
FROM metrics_sum
WHERE TimeUnix > now() - INTERVAL 1 DAY
GROUP BY ALL
ORDER BY last DESC
LIMIT 100
```

Span names of one service, with latency:
```sql
SELECT SpanName, SpanKind, count() AS c, quantile(0.95)(Duration) / 1e6 AS p95_ms
FROM traces
WHERE Timestamp > now() - INTERVAL 1 HOUR AND ServiceName = '<service>'
GROUP BY SpanName, SpanKind
ORDER BY c DESC
LIMIT 50
```

Recent errors:
```sql
SELECT Timestamp, ServiceName, Body, toString(LogAttributes.`exception.type`) AS type, TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 1 HOUR AND SeverityNumber >= 17
ORDER BY Timestamp DESC
LIMIT 50
```

Recent failed spans:
```sql
SELECT Timestamp, ServiceName, SpanName, StatusMessage, TraceId
FROM traces
WHERE Timestamp > now() - INTERVAL 1 HOUR AND StatusCode = 'Error'
ORDER BY Timestamp DESC
LIMIT 50
```

One trace, from its id. The `+ 1` covers the truncation of `End` to whole seconds. The same window works on `logs` for the logs of the trace:
```sql
WITH
  (SELECT min(Start) FROM traces_trace_id_ts WHERE TraceId = '<trace-id>') AS start,
  (SELECT max(End) + 1 FROM traces_trace_id_ts WHERE TraceId = '<trace-id>') AS end
SELECT Timestamp, ServiceName, SpanName, SpanKind, Duration / 1e6 AS ms, StatusCode, SpanId, ParentSpanId
FROM traces
WHERE Timestamp >= start AND Timestamp <= end
  AND TraceId = '<trace-id>'
ORDER BY Timestamp ASC
LIMIT 200
```

## Group Errors By Fingerprint

Everr groups error logs into Errors by a *fingerprint*: the `error.fingerprint` log attribute when present, else a hash of the service, exception type, and a normalized exception message. The ClickHouse function `errorFingerprint` computes it, so you get the same identity the app groups by. The "Copy agent prompt" button in the web UI hands you a Fingerprint. An error log has a `service.name` resource attribute, `SeverityNumber >= 17`, and an exception type or message.

Occurrences of one Fingerprint (widen the window if the Error is older):
```sql
SELECT toString(Timestamp) AS timestamp, ServiceName, TraceId,
  toString(LogAttributes.`exception.stacktrace`) AS stacktrace
FROM logs
WHERE Timestamp > now() - INTERVAL 7 DAY
  AND has(ResourceAttributesKeys, 'service.name')
  AND SeverityNumber >= 17
  AND errorFingerprint(ServiceName, toString(LogAttributes.`error.fingerprint`), toString(LogAttributes.`exception.type`), toString(LogAttributes.`exception.message`)) = '<fingerprint>'
ORDER BY Timestamp DESC
LIMIT 50
```
