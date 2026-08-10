# @everr/otel-errors

OpenTelemetry instrumentation for uncaught Node.js errors. It captures `uncaughtException` and `unhandledRejection` as OTel exception log records, marks the active span as errored, and exposes `captureError` for manual reports.

It emits through the SDK you already registered. No exporter, no endpoint, no init of its own.

> Previously published as `@everr/auto-otel-errors`. That package is deprecated. The browser, express, fastify, and react entries are gone: browser error capture lives in [`@everr/otel-web`](https://github.com/everr-labs/everr/tree/main/packages/otel-web).

## Install

```bash
pnpm add @everr/otel-errors @opentelemetry/api @opentelemetry/api-logs @opentelemetry/instrumentation
```

## Use

```ts
import { ErrorsInstrumentation } from "@everr/otel-errors";
import { NodeSDK } from "@opentelemetry/sdk-node";

new NodeSDK({
  instrumentations: [new ErrorsInstrumentation()],
}).start();
```

Manual capture works anywhere, with or without the instrumentation. Records emitted before an SDK registers a `LoggerProvider` are lost (a one-time diag warning says so). When an `ErrorsInstrumentation` exists, its options (redaction, rate limits, `beforeSend`) apply to manual captures too.

```ts
import { captureError } from "@everr/otel-errors";

try {
  await chargeCard(order);
} catch (error) {
  captureError(error, { "order.id": order.id });
}
```

## What it emits

One log record per error, with `eventName: "exception"`:

| Attribute | Value |
| --- | --- |
| `exception.type` | The error's constructor name, or `NonError` |
| `exception.message` | The message, redacted |
| `exception.stacktrace` | The stack, when there is one |
| `everr.error.mechanism` | `uncaughtException`, `unhandledrejection`, or `manual` |
| `log.record.uid` | A generated id, never redacted |

The record body is `"{type}: {message}"`, redacted. Severity is `FATAL` for the two fatal handlers and `ERROR` for `captureError`. When a span is active, the record joins its trace and the span gets `recordException` plus `setStatus(ERROR)`.

## On a fatal error

The instrumentation captures the error, flushes the logger, tracer, and meter providers (2 seconds for all three), then calls `process.exit(1)`.

The exit is deliberate. Installing an `uncaughtException` listener stops the crash Node would otherwise perform, so the instrumentation performs it. Two ways to keep the process alive:

- `new ErrorsInstrumentation({ onFatal: "continue" })`.
- Register your own listener for the same event. The instrumentation then leaves the decision to you.

## Config

```ts
new ErrorsInstrumentation({
  enabled: true,
  onFatal: "exit",
  rateLimit: { count: 5, windowMs: 5000 },
  redactPatterns: [/\bsk_live_\w+/g],
  redactKeys: { deny: ["session"] },
  beforeSend: (event) => (event.message.includes("ECONNRESET") ? null : event),
});
```

| Option | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | `false` defers installation until the SDK registers the instrumentation |
| `onFatal` | `"exit"` | `"continue"` keeps the process alive after a fatal error |
| `rateLimit` | 5 per 5s | Per-fingerprint throttle. `false` disables it |
| `redactPatterns` | emails, tokens, cards | Patterns replaced with `[Filtered]` in the body and string attributes |
| `redactKeys` | `true` | Drops attributes whose key looks sensitive. Also accepts `{ allow }` or `{ deny }` |
| `beforeSend` | none | Rewrites the event, or returns `null` to drop it |

## `@everr/otel-errors/core`

The capture path with no Node and no `@opentelemetry/instrumentation` dependency: `Client`, `normalizeError`, `RateLimiter`, and the redaction helpers. It exists so a browser-targeted SDK can reuse the normalization, redaction, and attribute contract without pulling `@types/node` into its globals. [`@everr/otel-web`](https://github.com/everr-labs/everr/tree/main/packages/otel-web)'s server entry is its consumer.

```ts
import { Client } from "@everr/otel-errors/core";

const client = new Client({ rateLimit: false });
client.setLogger(myLoggerProvider.getLogger("my-sdk"));
client.capture({ error, mechanism: "react" });
```

## License

MIT
