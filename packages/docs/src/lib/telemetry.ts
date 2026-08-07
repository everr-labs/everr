import {
  errors,
  interactions,
  network,
  pageviews,
  performance,
  WebSDK,
} from "@everr/otel-web";
import { env } from "@/env";

// Everr-native browser telemetry, storage-free (memory persistence, no
// cookies, ids die with the page): pageviews, frustration clicks, and web
// vitals flow to Everr as OTel log records. Runs alongside PostHog during
// the parallel-run window. The WebSDK is inert on the server and, without a
// key outside dev, never issues a network request; dev sends to the local
// collector. The route pattern is pushed by the TanStack adapter via
// setRouteResolver; `getRouter()` registers the router with it.
new WebSDK({
  persistence: "memory",
  serviceName: "everr-docs",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  // Capture is opt-in only: the full built-in composition.
  instrumentations: [
    errors(),
    pageviews(),
    interactions(),
    performance(),
    network(),
  ],
});
