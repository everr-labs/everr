# Browser Instrumentation

Use this rule for web apps that send OpenTelemetry directly from the browser: SPAs, websites, and any frontend that is not wrapped in Electron or Tauri. Wrapped frontends proxy through their backend process instead; use `electron.md` or `tauri.md` for those.

## Key Model

If production browser telemetry is needed and no public key exists, tell the user to mint one in the Everr dashboard: user menu, **API keys**, **New key**, turn on **Public browser key**, and add every origin the app is served from (`scheme://host` with an optional port, no paths). Origins cannot be edited later; changing them means minting a new key and rotating the value in the frontend config. Do not invent, print, or commit key values.

## Endpoint And Gating

- Local development: export to the local collector URL from `everr local status`. It accepts browser OTLP with no key and no origin setup.
- Production: export to `https://ingest.everr.dev/` with `Authorization: Bearer <public-key>`.
- Inject the public key through a client build-time variable, for example `VITE_EVERR_PUBLIC_INGEST_KEY` in Vite.
- No SSR guard is needed: `@everr/otel-web`'s WebSDK resolves a server entry under the `node` export condition and is inert there.

## Setup

```bash
npm install @everr/otel-web
```

```ts
// src/telemetry.ts, imported once before the app renders
import { errors, interactions, network, pageLoad, pageviews, performance, WebSDK } from "@everr/otel-web";

new WebSDK({
  serviceName: "<browser-service-name>",
  serviceVersion: "<version>",
  deploymentEnvironment: import.meta.env.MODE,
  // Unset in a production build makes the WebSDK inert: no emitter is built, so
  // a keyless deploy structurally cannot POST anywhere. Dev with no key falls
  // back to the local collector.
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  dev: import.meta.env.DEV,
  // Capture is opt-in. errors() owns the window error/unhandledrejection
  // handlers; never register your own alongside it, that double-captures.
  instrumentations: [errors(), pageviews(), interactions(), performance(), pageLoad(), network()],
});
```

Batches flush on a timer and on page hide, over `fetch` with `keepalive`.

For React render errors, add the error boundary at the root:

```tsx
import { ErrorBoundary } from "@everr/otel-web/react";

<ErrorBoundary fallback={<Oops />}>{children}</ErrorBoundary>;
```

Manual capture rides the same pipeline: `captureError(error, attributes)`, `logger.info(message, attributes)`, `identify(userId, traits)`, `setAttributes({ ... })`.

Error tracking hint: `errors()` plus the `ErrorBoundary` is the whole browser story; each error must be recorded exactly once, so throw a synthetic error and check the collector shows one record, not two (a hand-rolled `window` listener next to `errors()` is the usual double).

Choose a browser `service.name` distinct from the server's, per `resources.md`, so the two sides stay separable in queries.

### Identity And Consent

`persistence: "localStorage"` (the default) keeps a random visitor id and 30-minute-inactivity sessions across reloads and tabs. `persistence: "memory"` uses zero cookies and zero storage. The event schema is identical either way, so a consent-gated app boots with `"memory"` and re-initializes with `"localStorage"` once consent is granted.

### When The App Already Runs An OTel SDK

If the page already has a `LoggerProvider` for other reasons, keep it and let `@everr/otel-web` run its own pipeline alongside; they do not conflict. Do not hand-roll `window` error listeners to feed the existing provider, and do not add `@everr/otel-errors`: that package is Node-only.

## Validation

- Trigger the instrumented path in a real browser, then verify with `everr local query` filtered by the browser `ServiceName` and a fresh time window.
- A request from an origin missing from the key's allowlist returns 401 and the SDK drops the batch silently. When production rows are missing, check the page's origin against the key's allowlist before touching the code.
