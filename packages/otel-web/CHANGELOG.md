# @everr/otel-web

## 0.2.0

### Minor Changes

- 3dd9174: First public release, plus a host-owned transport.

  `init({ send })` hands each OTLP/JSON payload to the host instead of posting it, for apps that proxy their own telemetry (a Tauri or Electron renderer, a service worker, a test harness):

  ```ts
  init({ send: (signal, body) => invoke("proxy_otlp", { signal, body }) });
  ```

  With `send` set, `ingestKey`, `endpoint`, and `dev` are unused and the SDK issues no request of its own. Delivery stays best-effort: a throwing or rejecting `send` is swallowed exactly as a failed fetch is, and returning a promise makes `flush()` await it. The keepalive byte budget is a fetch constraint, so the exit flush ships the whole batch rather than truncating it.

  Also adds `serviceInstanceId`, which sets the `service.instance.id` resource attribute (omitted when unset).

  The server entry now consumes `@everr/otel-errors/core` in place of `@everr/auto-otel-errors/browser`.

### Patch Changes

- Updated dependencies [adfe27a]
  - @everr/otel-errors@0.1.0

## Unreleased

### Fixes

- Events now carry the time they occurred instead of the later reporting time. `InstrumentationContext.emit` accepts an optional timestamp, and the tracer supports every OpenTelemetry `TimeInput` form. Web vitals and user interactions use their browser performance or DOM event timestamps. Logs and traces are ordered by occurrence time within each payload.

### Breaking: capture is opt-in only

`init` now wires pipeline, transport, and identity and captures nothing by
itself. Every capture source is a plugin, composed explicitly:

```ts
import {
  errors,
  init,
  interactions,
  network,
  pageviews,
  performance,
} from "@everr/otel-web";

init({
  serviceName: "my-app",
  ingestKey: "...",
  // Yesterday's zero-config capture, spelled out:
  plugins: [errors(), pageviews(), interactions(), performance(), network()],
});
```

- A plugin is now its setup function: `type Plugin = (ctx: PluginContext) =>
(() => void) | void`. The `{ name, setup }` object shape is gone.
- `disable` and the `CaptureSignal` type are removed. Disabling a signal is
  now leaving its plugin out: `disable: ["interactions"]` becomes a plugin
  list without `interactions()`.
- Top-level `tracePropagationTargets` moved to the network plugin:
  `network({ tracePropagationTargets: [...] })`.
- Slow interactions (`everr.browser.slow_interaction`) are emitted by
  `performance()` (with the web vitals they share an observer with), not by
  `interactions()`.
- `errors(opts?)` owns the global unhandled-error and unhandled-rejection
  handlers and gains declarative filters: `ignore` (matched against the
  error message) and `denyUrls` (matched against the reporting script URL).
  Strings substring-match, RegExps test. The filters gate every error path,
  including manual `captureError`.
- The `everr.interaction.load_state` attribute is no longer emitted on slow
  interaction records or the INP vital.
- The base retains `logger`, `captureError`, `identify`, `revoke`,
  `setAttributes`, `setRouteResolver`; all keep working with no plugins.
- The package ships ESM with `sideEffects: false` and one module per plugin
  factory, so unimported factories contribute zero bytes.
- The server entry is unchanged: it accepts and ignores `plugins`, and
  exports inert versions of the five factories for shared code.
