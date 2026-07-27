import { init } from "@everr/web-sdk";
import { env } from "@/env";
import { routePattern } from "@/lib/route-pattern";

// Everr-native browser telemetry, strictly cookieless: pageviews, frustration
// clicks, and web vitals flow to Everr as OTel log records. Runs alongside
// PostHog during the parallel-run window. init() is inert on the server and,
// without a key outside dev, never issues a network request; dev sends to the
// local collector. The route pattern comes from the TanStack adapter;
// `getRouter()` registers the router with it.
init({
  mode: "cookieless",
  serviceName: "everr-docs",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  routePattern,
});
