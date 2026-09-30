# Error Tracking

Use this rule when the stack has no `@everr` SDK owning error capture: languages beyond JS (Python, Go, Java, Ruby, ...) and any runtime without a dedicated rule file. The JS runtimes carry their own compact hints (`@everr/otel-errors` on Node, `errors()` in the browser), and `rust.md` has "Errors And Panics"; this rule is the generic contract those hints compress.

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

Do not add a handled flag. How the error reached you is already on the record: `@everr/otel-errors` and `@everr/otel-web` stamp `everr.error.mechanism` (`uncaughtException`, `unhandledrejection`, `onerror`, `react`, `manual`), and a crash carries `FATAL` severity where a caught failure carries `ERROR`. A boolean beside those is a second, weaker spelling of the same fact.

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

Throwing a synthetic error and proving it lands exactly once is mandatory: follow the Error Path Gate in `validation.md`, which also holds the queries.
