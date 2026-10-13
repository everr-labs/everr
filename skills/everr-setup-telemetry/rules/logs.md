# Logs

OpenTelemetry log records describe discrete events. Use logs for facts, audit events, and causation after traces localize a problem.

Always check the OpenTelemetry semantic conventions for the domain, and comply with the standards where possible.

## Structured Logging

Use structured key-value logs. Do not rely on string interpolation for important fields.

```javascript
logger.info('order.placed', {
  order_id: orderId,
  amount,
});
```

Never spread request bodies, headers, form data, user profiles, or arbitrary objects into logs. Pick safe fields explicitly.

## Trace Correlation

Logs emitted inside an active span should carry trace context.

```javascript
import { context, trace } from '@opentelemetry/api';

function getTraceContext() {
  const span = trace.getSpan(context.active());
  if (!span) return {};
  const spanContext = span.spanContext();
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}
```

Wrap this in the existing logger instead of repeating it at every call site.

## Log Events

Use named log events only when the occurrence has a stable schema and is worth counting, filtering, or alerting on. Examples include deployment completion, payment completion, and user signup.

For general diagnostics, use regular structured logs without pretending every message is a formal event.

## Anti-Patterns

- Pretty-printed JSON logs in collected environments.
- Raw stack traces printed across multiple lines.
- Missing `trace_id` and `span_id` on logs emitted inside spans.
- Logging full request/response objects.
- Logging auth headers, cookies, request bodies, emails, tokens, or customer payloads.
- Monkey-patching all `console.*` output into telemetry for a runtime service.
