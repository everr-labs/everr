import { init } from "@everr/web-sdk";

// Everr-native browser telemetry for the web app (dogfooding), strictly
// cookieless: pageviews, frustration clicks, and web vitals flow to Everr as
// OTel log records under the app's service name, next to its server
// telemetry (`node.ts`). Browser error capture was removed for now and
// returns through the web SDK once its errors signal ships; until then
// `captureReactError` in the router's error component is a transport-less
// no-op.
//
// init() is inert on the server and, without a key outside dev, never issues
// a network request; dev sends to the local collector.

/**
 * Filled by `getRouter()` so web vitals can stamp the matched route pattern
 * (e.g. `/traces/$traceId`) at report time; a plain ref keeps the router out
 * of this module's import graph.
 */
export const routerRef: {
  current?: { state: { matches: ReadonlyArray<{ routeId: string }> } };
} = {};

init({
  mode: "cookieless",
  serviceName: "everr-dev-app",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: import.meta.env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: import.meta.env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
  routePattern: () => {
    const matches = routerRef.current?.state.matches;
    return matches?.[matches.length - 1]?.routeId;
  },
});
