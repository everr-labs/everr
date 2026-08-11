---
"@everr/otel-web": minor
---

First public release, plus a host-owned transport.

`init({ send })` hands each OTLP/JSON payload to the host instead of posting it, for apps that proxy their own telemetry (a Tauri or Electron renderer, a service worker, a test harness):

```ts
init({ send: (signal, body) => invoke("proxy_otlp", { signal, body }) });
```

With `send` set, `ingestKey`, `endpoint`, and `dev` are unused and the SDK issues no request of its own. Delivery stays best-effort: a throwing or rejecting `send` is swallowed exactly as a failed fetch is, and returning a promise makes `flush()` await it. The keepalive byte budget is a fetch constraint, so the exit flush ships the whole batch rather than truncating it.

Also adds `serviceInstanceId`, which sets the `service.instance.id` resource attribute (omitted when unset).

The server entry now consumes `@everr/otel-errors/core` in place of `@everr/auto-otel-errors/browser`.
