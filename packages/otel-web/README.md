# @everr/otel-web

Browser telemetry as OpenTelemetry log records: page views, interactions, web vitals, network spans, and errors. One small SDK, one OTLP endpoint, no separate analytics vendor.

Capture is opt-in. A bare `new WebSDK()` wires the pipeline and identity and captures nothing; you compose the instrumentations you want.

## Install

```bash
pnpm add @everr/otel-web
```

`@opentelemetry/api`, `@opentelemetry/api-logs`, and `react` are optional peers, needed only for the server entry and the React entry.

## Use

```ts
import { errors, interactions, network, pageviews, performance, WebSDK } from "@everr/otel-web";

new WebSDK({
  serviceName: "acme-web",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  dev: import.meta.env.DEV,
  instrumentations: [
    errors(),
    pageviews(),
    interactions(),
    performance({ pageLoad: true }),
    network(),
  ],
});
```

Without a key or an endpoint, a production build resolves to an inert client that never issues a request. In dev it falls back to the local collector on `127.0.0.1:54318`.

## Instrumentations

| Instrumentation | Captures |
| --- | --- |
| `errors()` | `window` errors and unhandled rejections, with `ignore` and `denyUrls` filters |
| `pageviews()` | Page views and page leaves, across SPA navigations |
| `interactions()` | Clicks, changes, submits, and rage clicks |
| `performance()` | Web vitals; `{ pageLoad: true }` adds the asset waterfall and long animation frames |
| `network()` | `fetch` and XHR as client spans |

Wrap any instrumentation in `sampled(rate, instrumentation)` to capture a fraction of sessions.

## Manual capture

```ts
import { captureError, identify, logger, setAttributes } from "@everr/otel-web";

logger.info("checkout started", { "cart.size": 3 });
captureError(error, { "order.id": id });
identify("u_123", { plan: "pro" });
setAttributes({ "feature.flag.new_nav": true });
```

React error boundaries live in a dedicated entry, so the core stays framework-free:

```tsx
import { ErrorBoundary } from "@everr/otel-web/react";

<ErrorBoundary fallback={<Oops />}>{children}</ErrorBoundary>;
```

## Identity

`persistence: "localStorage"` (the default) keeps a random visitor id and 30-minute-inactivity sessions across reloads and tabs. `persistence: "memory"` uses zero cookies and zero storage: the same ids exist only in JS memory and die with the page.

The event schema is identical either way. A consent-gated app boots with `"memory"` and constructs a new WebSDK with `"localStorage"` once consent is granted.

## Host-owned transport

An app that proxies its own telemetry (a Tauri or Electron renderer, a service worker, a test harness) takes over delivery with `send`. It receives one OTLP/JSON payload per signal, and the SDK issues no request of its own:

```ts
import { invoke } from "@tauri-apps/api/core";

new WebSDK({
  serviceName: "acme-desktop",
  send: (signal, body) => invoke("proxy_otlp", { signal, body }),
  instrumentations: [errors()],
});
```

`ingestKey`, `endpoint`, and `dev` are unused in this mode. Delivery stays best-effort: a throwing or rejecting `send` is swallowed exactly as a failed fetch is. Returning a promise makes `flush()` await it. The browser keepalive byte budget does not apply, so the exit flush ships the whole batch instead of truncating it.

## Server rendering

The `node` export condition resolves a server entry, so isomorphic code can import `logger` and `captureError` from the same specifier. On the server the SDK owns no pipeline: it attaches to the OpenTelemetry SDK your app already registered, and records join the request trace. WebSDK options are accepted and inert there, and lifecycle belongs to your `NodeSDK` handle.

`captureError` needs no `WebSDK` on the server. It reports through [`@everr/otel-errors`](https://github.com/everr-labs/everr/tree/main/packages/otel-errors)' shared client, so whatever redaction and rate limits you `configure` there cover these records too, and `shutdown()` leaves error capture running. `logger` keeps the gate: it needs a constructed `WebSDK`, and goes silent after `shutdown()`.

For Node process crashes, register that package's `ErrorsInstrumentation` on your `NodeSDK`.

## License

MIT
