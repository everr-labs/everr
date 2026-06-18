# @everr/auto-otel-errors

Automatic error tracking that emits through OpenTelemetry. The package captures uncaught exceptions, unhandled rejections, and framework errors as OTel exception log events, and exposes `captureError` for manual capture. It only reads the global OTel API registries; if the host app has no global `LoggerProvider`, capture is a no-op.

## Install

```bash
pnpm add @everr/auto-otel-errors @opentelemetry/api @opentelemetry/api-logs
```

## Quickstart

Node:

```ts
import { init } from "@everr/auto-otel-errors/node";

init();
```

Browser:

```ts
import { init } from "@everr/auto-otel-errors/browser";

init();
```

## Options

| Option | Description |
| --- | --- |
| `integrations` | Replaces the runtime defaults with explicit integrations. |
| `beforeSend` | Mutate an event or return `null` to drop it before emit. |
| `redactPatterns` | RegExp list applied to messages and string attributes. |
| `redactKeys` | Controls key-based sensitive data filtering. `true` (default) filters keys matching built-in denylist. `{ deny: ["custom"] }` or `{ allow: ["safe"] }` for custom filtering. `false` disables key filtering. |
| `rateLimit` | `{ count, windowMs }` per error key, or `false`. Default is 5 per 5 seconds. |
| `onFatal` | Node crash behavior for global handlers: `exit` or `continue`. Default is `exit`. |

## Manual Capture

```ts
import { captureError } from "@everr/auto-otel-errors";

captureError(new Error("payment failed"), { feature: "billing" });
```

## Capturing Third-Party Script Errors (`browserApiErrors`)

By default the browser entry only installs the `window` `error`/`unhandledrejection` handlers. The optional `browserApiErrors` integration additionally wraps `setTimeout`/`setInterval`/`requestAnimationFrame`/`addEventListener` callbacks so errors thrown inside them are captured with a real stack — including the cross-origin `"Script error."` cases the `window` `error` handler can't see.

It is **off by default** because it patches those globals process-wide. Enable it when capturing errors from third-party scripts (analytics, embeds, payment widgets) matters:

```ts
import {
  init,
  browserDefaultIntegrations,
  browserApiErrorsIntegration,
} from "@everr/auto-otel-errors/browser";

init({
  integrations: [...browserDefaultIntegrations(), browserApiErrorsIntegration()],
});
```

`integrations` replaces the defaults, so spread `browserDefaultIntegrations()` to keep the global handlers.

## Frameworks

Express:

```ts
import { errorHandler } from "@everr/auto-otel-errors/express";

app.use(errorHandler());
```

Fastify:

```ts
import { errorTrackingPlugin } from "@everr/auto-otel-errors/fastify";

await app.register(errorTrackingPlugin);
```

React:

```tsx
import { ErrorBoundary } from "@everr/auto-otel-errors/react";

<ErrorBoundary fallback={<div>Something went wrong.</div>}>
  <App />
</ErrorBoundary>;
```

## Data Model

Each captured error emits one exception log event with `eventName`, `exception.type`, `exception.message`, optional `exception.stacktrace`, `everr.error.handled`, `everr.error.mechanism`, and `log.record.uid`. Framework integrations add semantic attributes such as `http.request.method`, `http.route`, `url.full`, and `url.path` when available. Query strings and fragments are stripped from `url.full` before emission.

## Sensitive Data Redaction

The SDK redacts sensitive data using two layers:

1. **Key-based redaction**: Attribute keys matching sensitive patterns (e.g., `auth`, `token`, `password`, `secret`) are filtered automatically. Configure with `redactKeys` option.

2. **Value-based redaction**: String values are redacted using regex patterns (bearer tokens, emails, credit cards, etc.). Configure with `redactPatterns` option or use defaults.

```ts
init({
  // Disable key-based filtering while keeping attributes
  redactKeys: false,

  // Add value patterns for things the defaults do not cover
  redactPatterns: [/\b\d{3}-\d{2}-\d{4}\b/g], // SSN
});
```

Use either `deny` or `allow` when you want key-based filtering:

```ts
init({
  redactKeys: { deny: ["x-custom-secret"] },
});

init({
  // Sensitive keys are still filtered even when listed here
  redactKeys: { allow: ["content-type"] },
});
```

The log record is emitted in the active context, so when a trace is active it keeps that trace. On Node, a capture also marks the active span as errored (`recordException` + `ERROR` status).

## Crash Semantics

The Node default integration installs `uncaughtException` and `unhandledRejection` handlers. It captures the fatal error, best-effort flushes the global log provider when it supports `forceFlush`, then exits with code 1 unless `onFatal: "continue"` is configured or another application listener owns the event.
