---
"@everr/otel-web": minor
---

First public release, plus a host-owned transport.

The `dev` option is gone. The SDK reads `process.env.NODE_ENV` in its place, which every bundler replaces at build time. Thus a production build removes the local-collector address and the setup warnings from the bundle, and a development build keeps them. Delete `dev` from your options; there is nothing to put in its place.

The `dev` member of the instrumentation context is gone for the same reason. An instrumentation that needs the mode reads `process.env.NODE_ENV` itself.

`init({ send })` hands each OTLP/JSON payload to the host instead of posting it, for apps that proxy their own telemetry (a Tauri or Electron renderer, a service worker, a test harness):

```ts
init({ send: (signal, body) => invoke("proxy_otlp", { signal, body }) });
```

With `send` set, `ingestKey`, `endpoint`, and `dev` are unused and the SDK issues no request of its own. Delivery stays best-effort: a throwing or rejecting `send` is swallowed exactly as a failed fetch is, and returning a promise makes `flush()` await it. The keepalive byte budget is a fetch constraint, so the exit flush ships the whole batch rather than truncating it.

Also adds `serviceInstanceId`, which sets the `service.instance.id` resource attribute (omitted when unset).

The server entry now consumes `@everr/otel-errors/core` in place of `@everr/auto-otel-errors/browser`.
