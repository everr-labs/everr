# Spans

For every span, decide its name, kind, status behavior, attributes, and whether it adds diagnostic value.

## Span Naming

Span names must be low-cardinality. Use operation templates, not concrete identifiers.

| Bad | Better |
| --- | --- |
| `GET /api/users/123` | `GET /api/users/:id` |
| `SELECT * FROM orders WHERE id=99` | `SELECT orders` |
| `process_payment_for_user_alice` | `process payment` |
| `send_invoice_98765` | `send invoice` |

Common formats:

- HTTP server: `{method} {http.route}`
- HTTP client: `{method} {url.template}` or `{method}` when no safe template exists
- Database: `{db.operation.name} {db.collection.name}`
- RPC: `{rpc.service}/{rpc.method}`
- Messaging: `{operation} {destination}`
- Domain work: `{verb} {object}`, such as `process order`

Never use raw URLs, full SQL statements, usernames, emails, ids, or request bodies in span names.

## Path Parameterization

Use framework route templates when available. If not, replace dynamic path segments before setting route/path attributes.

```javascript
function parameterizePath(path) {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/{uuid}')
    .replace(/\/\d+/g, '/{id}');
}
```

Use `http.route` for server-side routes and `url.template` for client-side templates where possible.

## Exceptions

Record exceptions as structured logs correlated with the active span. Avoid generic log messages such as `error` or `exception`; use an operation-oriented message such as `order.charge.failed`.

Include safe exception fields:

- `exception.type`
- `exception.message`
- `exception.stacktrace`
- `trace_id`
- `span_id`

Do not echo request bodies, auth headers, tokens, or user-supplied raw values into exception logs.

## Attributes

Add attributes that answer incident questions. Prefer standard semantic-convention attributes. Use a project-specific namespace for custom attributes.

Good span attributes can include opaque ids, bounded categories, feature flag names/variants, route templates, tenant-safe ids, and operation counts.

Avoid attributes containing request bodies, raw URLs with query params, serialized objects, arrays, emails, usernames, tokens, cookies, or full headers.

Add business attributes to auto-instrumented spans by retrieving the active span; do not create a redundant child span solely to add attributes.

## Headless Work

Cron jobs, background workers, CLI commands, startup tasks, and batch jobs often have no inbound request span. Wrap the unit of work in a manual root span so outbound database or HTTP spans do not become root `CLIENT` spans.

```javascript
await tracer.startActiveSpan('process daily orders', async (span) => {
  try {
    await processDailyOrders();
  } finally {
    span.end();
  }
});
```

## Hygiene

- Root spans should be `SERVER`, `CONSUMER`, or meaningful `INTERNAL`, not `CLIENT`.
- `CLIENT` and `PRODUCER` spans should have a parent that explains why the outbound work happened.
- Every child span should have a parent span in the same trace.
- Keep `INTERNAL` spans sparse; avoid tracing tight loops.
- Replace per-item spans with one batch span plus `batch.size`.
- Use logs for lightweight annotations.
- Keep application SDK sampling at the default unless the project has an explicit collector-side sampling plan. Application-side head sampling drops evidence before outcome is known.

## Tests

For risky or shared instrumentation, use in-memory exporters in integration tests and assert:

- No parentless `CLIENT` or `PRODUCER` spans.
- No orphan spans.
- Error spans have non-empty status messages.
- Span names are low-cardinality and do not contain concrete ids.
- Custom attributes do not contain sensitive data.
