# Browser Instrumentation

Use this rule for web apps that send OpenTelemetry directly from the browser: SPAs, websites, and any frontend that is not wrapped in Electron or Tauri. Wrapped frontends proxy through their backend process instead; use `electron.md` or `tauri.md` for those.

## Key Model

Anything shipped to a browser is visible to every visitor, so browser ingestion never uses a secret key. Everr has two API key kinds and the split is strict:

- **Public keys**: created with **Public browser key** enabled and an origin allowlist. Safe to ship in page source: they only authenticate requests whose `Origin` header matches the allowlist, they are rejected without an `Origin` header (so they are useless server-side), and they can only send telemetry, never `everr apply` or any other API.
- **Secret keys** (`EVERR_INGEST_KEY`): server-to-server only. Rejected the moment a browser `Origin` header appears. Never put one in a browser bundle, client env var, or page source.

If production browser telemetry is needed and no public key exists, tell the user to mint one in the Everr dashboard: user menu, **API keys**, **New key**, turn on **Public browser key**, and add every origin the app is served from (`scheme://host` with an optional port, no paths). Origins cannot be edited later; changing them means minting a new key and rotating the value in the frontend config. Do not invent, print, or commit key values.

## Endpoint And Gating

- Local development: export to the local collector URL from `everr local status`. It accepts browser OTLP with no key and no origin setup.
- Production: export to `https://ingest.everr.dev/` with `Authorization: Bearer <public-key>`.
- Inject the public key through a client build-time variable, for example `VITE_EVERR_PUBLIC_INGEST_KEY` in Vite. Public keys are not secrets, but keep the value out of the repo so it can rotate without a commit.
- Gate on the key: when the variable is unset in a production build, telemetry must be a no-op so a keyless deploy never POSTs anywhere. In dev builds, fall back to the local collector so developers see their own browser telemetry with no setup.
- Guard for the browser (`typeof window === "undefined"` returns early) so the module is a no-op during SSR.

## Setup

Run normal OTel web providers with OTLP/HTTP exporters pointed at the resolved endpoint. Logs, with error capture wired on top:

```ts
import { init as initErrorTracking } from "@everr/auto-otel-errors/browser";
import { logs } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const loggerProvider = new LoggerProvider({
  resource: resourceFromAttributes({
    "service.name": "<browser-service-name>",
    "service.version": "<version>",
    "deployment.environment.name": "<environment>",
    "service.instance.id": crypto.randomUUID(),
  }),
  processors: [
    new BatchLogRecordProcessor(
      new OTLPLogExporter({
        url: `${endpoint}/v1/logs`,
        headers, // { Authorization: `Bearer ${publicKey}` } in production, none locally
      }),
    ),
  ],
});
logs.setGlobalLoggerProvider(loggerProvider);

// Transport-less: init() is a no-op unless a global LoggerProvider is
// registered first. Installs window error / unhandledrejection handlers.
initErrorTracking();

window.addEventListener("beforeunload", () => {
  void loggerProvider.shutdown(); // best-effort flush of batched records
});
```

Traces work the same way with `WebTracerProvider` plus `OTLPTraceExporter` (`/v1/traces`), metrics with `/v1/metrics`. For React render errors, add the `@everr/auto-otel-errors/react` `ErrorBoundary` at the root.

Choose a browser `service.name` distinct from the server's, per `resources.md`, so the two sides stay separable in queries.

## Validation

- Trigger the instrumented path in a real browser, then verify with `everr local query` filtered by the browser `ServiceName` and a fresh time window.
- A request from an origin missing from the key's allowlist returns 401 and the SDK drops the batch silently. When production rows are missing, check the page's origin against the key's allowlist before touching the code.
