import {
  errors,
  interactions,
  network,
  pageLoad,
  pageviews,
  performance,
  WebSDK,
} from "@everr/otel-web";
import { env } from "@/env";

// The browser telemetry of the docs site. It writes nothing to a store: it uses
// the memory store, it sets no cookie, and its ids end with the page. The page
// views, the frustration clicks, and the web vitals go to Everr as OTel log
// records. This code operates with PostHog while the two systems operate
// together.
//
// The WebSDK does nothing on the server. Without a key, and not in the
// development mode, it makes no network request. In the development mode it
// sends the data to the local collector. The TanStack adapter gives the route
// pattern with setRouteResolver, and `getRouter()` registers the router with
// that adapter.
new WebSDK({
  persistence: "memory",
  serviceName: "everr-docs",
  deploymentEnvironment: import.meta.env.MODE,
  ingestKey: env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: env.VITE_EVERR_INGEST_ENDPOINT,
  // The caller must select the capture. This site uses all the built-in
  // instrumentations.
  instrumentations: [
    errors(),
    pageviews(),
    interactions(),
    performance(),
    pageLoad(),
    network(),
  ],
});
