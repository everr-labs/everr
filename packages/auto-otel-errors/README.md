# @everr/auto-otel-errors

Sentry-style automatic error tracking that emits through OpenTelemetry. The package captures runtime errors, console errors, failed network calls, and framework errors as OTel log records, and lazily emits breadcrumb context as an `error.context` span only when an error is recorded. It only reads the global OTel API registries; if the host app has no global `LoggerProvider`, capture is a no-op.

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
| `scrubPatterns` | RegExp list applied to messages and string attributes. |
| `rateLimit` | `{ count, windowMs }` per error key, or `false`. Default is 5 per 5 seconds. |
| `console` | Console capture settings. Default captures `error`; breadcrumbs include all levels. |
| `network` | HTTP status capture predicate and ignored URL patterns. Default captures status `>= 500`. |
| `breadcrumbs` | Ring buffer and source toggles, or `false`. Default max is 100. |
| `onFatal` | Node crash behavior for global handlers: `exit` or `continue`. Default is `exit`. |

## Manual Capture

```ts
import { addBreadcrumb, captureError } from "@everr/auto-otel-errors";

addBreadcrumb({ category: "checkout", message: "clicked pay" });
captureError(new Error("payment failed"), { feature: "billing" });
```

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

Each captured error emits one log record with `exception.type`, `exception.message`, optional `exception.stacktrace`, `exception.handled`, `exception.mechanism`, and `error.id`. Network and framework integrations add semantic attributes such as `http.request.method`, `http.response.status_code`, `http.route`, and `url.full`.

Breadcrumbs are buffered in memory. When an error passes rate limiting and `beforeSend`, the package emits one `error.context` span with breadcrumb events and the same `error.id`. If a real trace is active, the log record keeps that trace and the breadcrumb span links to it. Without an active trace, the log record is emitted inside the synthesized breadcrumb span context.

## Crash Semantics

The Node default integration installs `uncaughtException` and `unhandledRejection` handlers. It captures the fatal error, best-effort flushes the global log provider when it supports `forceFlush`, then exits with code 1 unless `onFatal: "continue"` is configured or another application listener owns the event.
