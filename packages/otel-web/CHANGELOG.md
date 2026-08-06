# @everr/otel-web

## Unreleased

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
