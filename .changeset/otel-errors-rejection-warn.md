---
"@everr/otel-errors": minor
---

Unhandled rejections no longer stop the process by default. The new `onUnhandledRejection` option defaults to `"warn"`: the rejection is written to stderr, captured with `ERROR` severity, and the process keeps running, as with Sentry. Pass `onUnhandledRejection: "strict"` to keep the previous behavior (captured as `FATAL`, flushed, then the process exits).
