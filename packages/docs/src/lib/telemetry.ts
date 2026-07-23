import { init } from "@everr/web-sdk";
import { env } from "@/env";

// Everr-native browser telemetry, strictly cookieless: pageviews, clicks,
// rage/dead clicks flow to Everr as OTel log records. Runs alongside PostHog
// during the parallel-run window. init() is inert on the server and, without
// a key outside dev, never issues a network request; dev sends to the local
// collector.
init({
  mode: "cookieless",
  serviceName: "everr-docs",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: env.VITE_EVERR_PUBLIC_INGEST_KEY,
  dev: import.meta.env.DEV,
});
