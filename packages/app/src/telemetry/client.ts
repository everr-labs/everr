import {
  errors,
  interactions,
  network,
  pageviews,
  performance,
  WebSDK,
} from "@everr/otel-web";
import { readConsent } from "@/telemetry/consent";
import { parameterizeTelemetryPath } from "@/telemetry/paths";

// Everr-native browser telemetry for the web app (dogfooding): pageviews,
// frustration clicks, web vitals, and errors flow to Everr as OTel log
// records under a browser service name distinct from the server's
// (`node.ts`), so the two sides stay separable in queries. Error capture rides the SDK's own errors() instrumentation
// (window.onerror, unhandledrejection, and the router's error component via
// the re-exported `captureReactError`), stamped with the same analytics
// envelope.
//
// Persistence boots from the stored consent cookie: memory (no storage, ids
// die with the page) until consent is granted. A consent change flips the
// live client in place via setPersistence()/revoke() (see
// telemetry/consent-gate.tsx); this only picks the initial mode. The
// WebSDK is inert on the server and, without a key outside dev, never issues a
// network request; dev sends to the local collector. The route pattern is pushed
// by the TanStack adapter via setRouteResolver; `getRouter()` registers
// the router with it.
new WebSDK({
  persistence: readConsent() === "granted" ? "localStorage" : "memory",
  serviceName: "everr-dev-app-web",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: import.meta.env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  // Capture is opt-in only: the full built-in composition. performance()
  // includes the page-load window (asset waterfall + long-animation-frame
  // records) by default.
  instrumentations: [
    errors(),
    pageviews(),
    interactions(),
    performance(),
    // The same parameterization the server stamps on http.route, so a
    // request's url.template (notably /_serverFn/:id) matches its server
    // span's route.
    network({
      resolveRouteTemplate: (url) => parameterizeTelemetryPath(url.pathname),
    }),
  ],
});
