import {
  errors,
  init,
  interactions,
  network,
  pageviews,
  performance,
} from "@everr/otel-web";
import { readConsent } from "@/telemetry/consent";

// Everr-native browser telemetry for the web app (dogfooding): pageviews,
// frustration clicks, web vitals, and errors flow to Everr as OTel log
// records under the app's service name, next to its server telemetry
// (`node.ts`). Error capture rides the SDK's own errors() plugin
// (window.onerror, unhandledrejection, and the router's error component via
// the re-exported `captureReactError`), stamped with the same analytics
// envelope.
//
// Persistence follows the stored consent cookie (see
// telemetry/consent-gate.tsx): memory (no storage, ids die with the page)
// until the banner is accepted, then localStorage on the next boot. init()
// is inert on the server and, without a key outside dev, never issues a
// network request; dev sends to the local collector. The route pattern is pushed
// by the TanStack adapter via setRouteResolver; `getRouter()` registers
// the router with it.
init({
  persistence: readConsent() === "granted" ? "localStorage" : "memory",
  serviceName: "everr-dev-app",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: import.meta.env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  // Capture is opt-in only: the full built-in composition. pageLoad opens
  // the load window (asset waterfall + long-animation-frame records).
  plugins: [
    errors(),
    pageviews(),
    interactions(),
    performance({ pageLoad: true }),
    network(),
  ],
});
