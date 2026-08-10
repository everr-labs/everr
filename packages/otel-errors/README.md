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

Manual capture works anywhere, with or without the instrumentation. Records emitted before an SDK registers a `LoggerProvider` are lost (a one-time diag warning says so). Every error path in the process shares one client, so whatever you pass to `configure` covers manual captures and crashes alike.

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
| `exception.message` | The message |
| `exception.stacktrace` | The stack, when there is one |
| `everr.error.mechanism` | `uncaughtException`, `unhandledrejection`, or `manual` |
| `log.record.uid` | A generated id |

The record body is `"{type}: {message}"`. Severity is `FATAL` for the two fatal handlers and `ERROR` for `captureError`. When a span is active, the record joins its trace and the span gets `recordException` plus `setStatus(ERROR)`.

One capture is one record. The package applies no throttle and no deduplication, so a hot loop that reports the same error 10,000 times emits 10,000 records. Cap volume where it can be seen across processes: `beforeSend`, the collector, or the ingest.

## Sensitive data

This package removes nothing. The message, the stack, and the attributes you pass reach the exporter unchanged. `beforeSend` is the one lever: rewrite the record, or return `null` to drop it.

It does not reach the active span. When a span is active it gets `recordException` and `setStatus` built from the error itself, not from what your hook returned, so a hook that scrubs the message leaves a dirty span in the same trace. Returning `null` skips both. For the span, use a span processor on your own `NodeSDK`, or redact at the collector, which covers every signal at once.

## On a fatal error

The instrumentation writes the error to stderr, captures it, flushes the logger, tracer, and meter providers (`shutdownTimeout`, 2 seconds by default, for all three), then calls `process.exit(1)`.

The stderr line comes first and is unconditional. Installing an `uncaughtException` listener stops the report Node writes, so without it a crashing container logs nothing locally and the error survives only if the flush reached the collector. It is `console.error(reason)`, so you get the same stack Node would have printed. Expect one duplicate line if your own handler also logs.

The exit is deliberate, for the same reason: a listener stops the crash Node would otherwise perform, so the instrumentation performs it. Three ways to change that:

- `onFatal: "continue"` keeps the process alive.
- Register your own listener for the same event. The instrumentation then leaves the decision to you.
- `exitEvenIfOtherHandlersAreRegistered: true` overrides the previous one and exits regardless.

## Config

The process has one error client. `configure` sets it up, merging over whatever is already there: an absent key keeps its current value, and a present one replaces that field.

```ts
import { configure } from "@everr/otel-errors";

configure({
  beforeSend: (event) => (event.message.includes("ECONNRESET") ? null : event),
});
```

| Option | Default | Effect |
| --- | --- | --- |
| `beforeSend` | none | Rewrites the log record, or returns `null` to drop it. `null` removes an installed hook |

Call it whenever you like: capture works before the first call, and a later call applies to every error path from then on.

The instrumentation itself takes only what belongs to crash handling:

| Option | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | `false` defers installation until the SDK registers the instrumentation |
| `onFatal` | `"exit"` | `"continue"` keeps the process alive after a fatal error |
| `shutdownTimeout` | `2000` | Milliseconds the three flushes share before the process stops |
| `exitEvenIfOtherHandlersAreRegistered` | `false` | `true` exits even when your own listener is attached |

## `@everr/otel-errors/core`

The capture path with no Node and no `@opentelemetry/instrumentation` dependency: `capture`, `configure`, `setLogger`, and `normalizeError`. It exists so a browser-targeted SDK can reuse the normalization and the attribute contract without pulling `@types/node` into its globals. [`@everr/otel-web`](https://github.com/everr-labs/everr/tree/main/packages/otel-web)'s server entry is its consumer.

`capture` is the surface for SDKs that report their own mechanisms, where an application wants `captureError`:

```ts
import { capture, setLogger } from "@everr/otel-errors/core";

setLogger(myLoggerProvider.getLogger("my-sdk"));
capture({ error, mechanism: "react" });
```

## License

Apache-2.0. See [LICENSE](./LICENSE).
