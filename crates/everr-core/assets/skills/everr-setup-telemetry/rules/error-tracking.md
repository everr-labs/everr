# Error Tracking

Error tracking is the combination of:
- Span status on the failed operation.
- Structured exception logs with trace correlation.

Don't worry about error grouping, Everr handles that automatically.

## Framework Docs Are Required

- Identify the frameworks and libraries used
- Check their docs if they expose a way to catch or track errors

If yes, use that and syntetically try to throw an error to see if it is recorded correctly, and also important, not recorded twice.

If framework docs show examples for a vendor-specific SDK, adapt them to use the otel SDK if there is no otel-native examples/docs.

## Span Status

Set the span status to `ERROR` only on the span representing the failed operation. Include a short, non-sensitive status message.

Good status message shape:

```text
TimeoutError: payment service timeout exceeded
```

For retries, log failed attempts or add bounded attempt attributes, then set span status to `ERROR` only after the final failure.

## Exception Logs

Record exceptions as structured logs in the active span context.

Required fields when available:

- `exception.type`
- `exception.message`
- `exception.stacktrace`
- `trace_id`
- `span_id`

Use an operation-oriented log body, such as `order.charge.failed`, not a generic body like `error` or `exception`.

Keep stack traces as one structured field. Do not emit multiline stack traces as separate log records.

## Handled vs Unhandled

Use a low-cardinality handled flag when useful:

- `error.handled=true` for exceptions caught and converted into a controlled failure response.
- `error.handled=false` for unhandled exceptions, fatal crashes, and process-level failures.

If the codebase already has a project-specific error namespace, follow it. Otherwise keep custom error attributes sparse and documented.

## Sensitive Data

Apply `sensitive-data.md` before adding any error fields.

Common error leaks:

- Validation errors echoing request bodies.
- Database errors containing literal query parameters.
- HTTP client errors containing full URLs with tokens.
- Auth failures logging headers or cookies.
- Stack traces containing environment variables in messages.

Redact at the source when possible and use collector-side redaction only as a second layer.

## Validation

Especially when instrumenting errors, it is a MUST to try to throw a syntetic error and see if it is reported correctly.

Use a browser or an API call to trigger the error using a public path.

VALIDATION IS IMPORTANT, don't skip it.

Validate error tracking from multiple sourcers:
- API handlers
- UI components in SSR
- Server functions
- Middlewares
- Cron or background tasks

## Validation queries

Recent error spans:

```sql
SELECT Timestamp, ServiceName, SpanName, StatusMessage, TraceId
FROM otel_traces
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
  AND StatusCode = 'Error'
ORDER BY Timestamp DESC
LIMIT 20
```

Recent exception logs:

```sql
SELECT Timestamp, ServiceName, SeverityText, Body, LogAttributes, TraceId
FROM otel_logs
WHERE Timestamp > now() - INTERVAL 10 MINUTE
  AND ServiceName = '<service-name>'
  AND SeverityNumber >= 17
  AND mapContains(ResourceAttributes, 'service.name')
  AND (
    LogAttributes['exception.type'] != ''
    OR LogAttributes['exception.message'] != ''
  )
ORDER BY Timestamp DESC
LIMIT 20
```
