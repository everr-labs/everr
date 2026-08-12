---
"@everr/otel-errors": minor
---

Renamed from `@everr/auto-otel-errors`, and reduced to the Node runtime.

`init()` is gone. The package now exports an OpenTelemetry instrumentation, registered with the SDK like any other:

```ts
new NodeSDK({ instrumentations: [new ErrorsInstrumentation()] });
```

The SDK injects its own `LoggerProvider`, so the package no longer reads the `logs` global to emit, and a fatal error now flushes logs, spans, and metrics (previously logs only) before exiting.

Removed: the `browser`, `express`, `fastify`, and `react` entries. Browser error capture lives in `@everr/otel-web`, which owns the `window` handlers, the React error boundary, and its own capture path.

Added: a `./core` entry with the runtime-neutral capture path (`Client`, normalization, redaction, rate limiting) for SDKs that drive it themselves.

`Client` takes only options now: the `runtime` and `integrations` parameters are gone, and it always marks the active span. The `Mechanism` type accepts any string so a consuming SDK can report its own vocabulary.

The OTel instrumentation scope on every emitted record changes from `@everr/auto-otel-errors` to `@everr/otel-errors`. Queries filtering on the old scope name return no rows after upgrading.
