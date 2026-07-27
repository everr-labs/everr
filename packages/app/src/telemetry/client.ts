import { init } from "@everr/web-sdk";
import { routePattern } from "@/telemetry/route-pattern";

// Everr-native browser telemetry for the web app (dogfooding), strictly
// cookieless: pageviews, frustration clicks, web vitals, and errors flow to
// Everr as OTel log records under the app's service name, next to its server
// telemetry (`node.ts`). Error capture rides @everr/auto-otel-errors inside
// the SDK (window.onerror, unhandledrejection, and the router's error
// component via the re-exported `captureReactError`), stamped with the same
// analytics envelope.
//
// init() is inert on the server and, without a key outside dev, never issues
// a network request; dev sends to the local collector. The route pattern
// comes from the TanStack adapter; `getRouter()` registers the router with
// it.
init({
  mode: "cookieless",
  serviceName: "everr-dev-app",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: import.meta.env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  routePattern,
});
