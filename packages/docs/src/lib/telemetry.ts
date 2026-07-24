import { init } from "@everr/web-sdk";
import { env } from "@/env";

// Everr-native browser telemetry, strictly cookieless: pageviews, frustration
// clicks, and web vitals flow to Everr as OTel log records. Runs alongside
// PostHog during the parallel-run window. init() is inert on the server and,
// without a key outside dev, never issues a network request; dev sends to the
// local collector.

/**
 * Filled by `getRouter()` so web vitals can stamp the matched route pattern
 * (e.g. `/docs/$`) at report time; a plain ref keeps the router out of this
 * module's import graph.
 */
export const routerRef: {
  current?: { state: { matches: ReadonlyArray<{ routeId: string }> } };
} = {};

init({
  mode: "cookieless",
  serviceName: "everr-docs",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  routePattern: () => {
    const matches = routerRef.current?.state.matches;
    return matches?.[matches.length - 1]?.routeId;
  },
});
