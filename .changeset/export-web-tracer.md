---
"@everr/otel-web": patch
---

Export `tracer` alongside `logger` to capture custom interaction segments with `startSpan()` and `startActiveSpan()`. Browser segments use the existing telemetry pipeline, default to INTERNAL spans, and share active parents with built-in instrumentation. Active browser spans remain active until `end()`, including across awaited work; overlapping work joins the most recently active span.

The browser export follows SDK replacement and returns non-recording spans before initialization or after shutdown. The server export uses the application's registered OpenTelemetry provider and context manager.
