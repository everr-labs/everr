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
  // Without the commit, the SDK falls back to its own package version.
  serviceVersion: env.VITE_COMMIT_SHA,
  deploymentEnvironment: import.meta.env.MODE,
  // The public key is origin-bound and ingest-only, and Vite bakes it into the
  // client bundle at build time. It comes from the DOCS_EVERR_PUBLIC_INGEST_KEY
  // repository variable, which the image build passes as a build argument. When
  // that variable holds nothing, the bundle carries no key and the telemetry
  // stays off without a sign. The origin of the site must appear on the allowed
  // origins of the key, or the collector refuses the authenticated request.
  ingestKey: env.VITE_EVERR_PUBLIC_INGEST_KEY,
  endpoint: env.VITE_EVERR_INGEST_ENDPOINT,
  dev: import.meta.env.DEV,
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
