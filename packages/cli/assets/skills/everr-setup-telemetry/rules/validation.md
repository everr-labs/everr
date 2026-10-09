# Validation

## Select the query destination

Validate against the store receiving the instrumented app's telemetry:

| Export destination | Query command | Prerequisite |
| --- | --- | --- |
| Local collector | `everr local query "<SQL>"` | Collector running; endpoint from `everr local status` |
| Everr Cloud | `everr cloud query "<SQL>"` | CLI query access and app ingest credentials for the same organization; see [Cloud setup](../references/cloud-setup.md) |

The SQL examples below apply to either store. Adapt the service, environment, and marker filters to the exercised path. A local collector is unnecessary for cloud validation, including a development run sent to cloud. When both local and production setup are requested, verify each independently; local ingestion does not prove production ingestion.

## Preflight

Before querying the backend, verify:

- Traces/logs/metrics exporters are enabled for SDKs that default them to `none`.
- Instrumentation is loaded before framework, HTTP, database, or queue modules.
- Local collector is running when exporting locally.

For local export, use `everr local status` and the returned `otlp:` URL. For cloud export, verify hosted endpoint and key configuration, including origin restrictions for browser keys, and use `everr cloud query`.

## Repair Validation Gate

Before changing a broken setup, record the reproducible symptom, the expected behavior, and the known-working signals that share components being changed. Keep the service, environment, exercised path, and query filters explicit so the before/after comparison targets the same behavior.

After the correction:

1. Repeat the reproduction with a fresh marker when practical and complete the ingestion validation gate against the selected destination.
2. Demonstrate that the original symptom is resolved. Finding some telemetry is insufficient if the reported problem was missing correlation, incorrect attributes, or duplicate records.
3. Recheck previously working signals affected by the changed provider, exporter, or startup hook.
4. Verify that the exercised operation produces the expected records without duplicate capture or export, accounting for legitimate parent/child spans and metric aggregation.

Report the failing stage, the correction, and the before/after evidence. If the original symptom cannot be reproduced or the affected signals cannot be checked, state that limitation instead of claiming a verified repair.

## Error Path Gate

When error capture is part of the setup, throwing a synthetic error is a MUST, not optional. Trigger it through a public path (a browser interaction or an API call), then confirm in the selected telemetry store:

- Exactly one exception record per error, not two (framework hook plus custom capture is the usual double).
- The error log carries `exception.type`, `exception.message`, `exception.stacktrace`, and `TraceId`/`SpanId` when thrown inside an active span.
- Span status `ERROR` appears only on the failed operation's span.

Cover each error source the app actually has: API handlers, SSR components, server functions, middlewares, and background tasks.

Recent error spans:

```sql
SELECT Timestamp, ServiceName, SpanName, StatusMessage, TraceId
FROM traces
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
  AND StatusCode = 'Error'
ORDER BY Timestamp DESC
LIMIT 20
```

Recent exception logs:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body, LogAttributes, TraceId, SpanId
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
  AND SeverityNumber >= 17
  AND (
    has(LogAttributesKeys, 'exception.type')
    OR has(LogAttributesKeys, 'exception.message')
  )
ORDER BY Timestamp DESC
LIMIT 20
```

## Build Gate

Telemetry setup usually touches build-sensitive files (setup modules, framework entrypoints, TypeScript config edges). Run the project's production build (or at least its typecheck) after the changes and before claiming setup works. Dev servers skip strict type checking, so telemetry that flows in dev can still break the build.

## Ingestion Validation Gate

1. Pick the expected `service.name`.
2. Add or identify a safe unique marker such as request id, test id, route, or job id.
3. Trigger the exact code path. When possible, exercise the running app manually with browser navigation or `curl` API calls instead of relying only on automated tests.
4. Query the selected destination over a recent time window.
5. Filter by `ServiceName`, the expected environment when services share a cloud store, and marker when a marker exists.
6. Confirm rows include the expected span/log/metric names and attributes.

If access or deployment prevents exercising the selected environment, report ingestion as unverified with the missing prerequisite. Build success or telemetry from another environment cannot substitute for this gate.

Fresh trace query:

```sql
SELECT Timestamp, ServiceName, SpanName, StatusCode, TraceId
FROM traces
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
ORDER BY Timestamp DESC
LIMIT 20
```

Fresh log query:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body, TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
ORDER BY Timestamp DESC
LIMIT 20
```

Marker trace query:

```sql
SELECT Timestamp, ServiceName, SpanName, TraceId
FROM traces
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
  AND (
    toString(ResourceAttributes.`request.id`) = '<request-id>'
    OR toString(SpanAttributes.`request.id`) = '<request-id>'
  )
ORDER BY Timestamp DESC
LIMIT 20
```

Marker log query:

```sql
SELECT Timestamp, ServiceName, Body, TraceId
FROM logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
  AND (
    toString(ResourceAttributes.`request.id`) = '<request-id>'
    OR toString(LogAttributes.`request.id`) = '<request-id>'
  )
ORDER BY Timestamp DESC
LIMIT 20
```

## Signal-Specific Checks

Traces:

- Inbound requests have a `SERVER` span.
- Background/headless work has a meaningful root span.
- Outbound HTTP/database calls are child `CLIENT` spans.
- Message publishing uses `PRODUCER`; message handling uses `CONSUMER`.
- Error spans have useful status messages.
- Span names are route/operation templates, not concrete ids.

Logs:

- Severity is set.
- Body is useful and structured.
- Logs inside traces include `trace_id` and `span_id`.
- Exceptions use structured `exception.*` fields.
- No duplicate logs from simultaneous stdout and direct OTLP paths unless deduplicated.

Error tracking:

- Failed operations set span status to `ERROR` only when the failure is final.
- Error spans include useful non-sensitive status messages.
- Exception logs include `exception.type`, `exception.message`, and `exception.stacktrace` when available.
- Exception logs emitted in a span include `trace_id` and `span_id`.
- Crash handlers flush telemetry and preserve the original failure behavior.

Metrics:

- Expected metric names exist.
- Units are correct.
- Instrument types match the measurement.
- Attributes are bounded.
- Custom metrics do not duplicate auto-instrumented metrics.

Resources:

- `service.name` is not `unknown_service`.
- `deployment.environment.name` is correct.
- `service.version` is populated for production.

## Common Failures

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No telemetry | Collector stopped, endpoint wrong, exporter disabled, protocol mismatch | Check status, env, protocol, and startup order |
| `unknown_service` | Missing `service.name` resource attribute | Hardcode a stable service name in setup code |
| Spans but no logs | Logger bridge/export path missing | Configure structured logger or OTel logs path |
| Logs lack trace ids | Logger does not read active span context | Add trace context helper or bridge |
| Crashes missing | Process exits before buffers flush | Add runtime crash handlers that log, flush, then preserve exit behavior |
| Metrics missing | SDK exporter disabled or reader not configured | Enable metrics exporter/reader |
| Duplicate logs | stdout collector and OTLP log exporter both active | Choose one path or deduplicate |
| High cardinality | Raw URLs, ids, or user values in metric attributes | Normalize or remove attributes |

If validation fails, fix instrumentation or configuration before continuing with feature work.
